import {error} from '@sveltejs/kit'
import {getAPI, post} from '$lib/utils/api'
import type {AllProducts} from '$lib/types'
import {
  ATTRIBUTE_SHORT_DESCRIPTION,
  LANGUAGE_TAG,
  mapProdexaAllProducts,
  mapProdexaAttrFacets,
  mapProdexaCategoryClassification,
  mapProdexaFacet,
  mapProdexaFacets,
  mapProdexaProduct,
  SLUG_SEPARATOR
} from './prodexa-utils'
import queryString from 'query-string'
import {currencyCode} from '$lib/config'

const productsEndpoint = 'products/search/full-product'
const productsFacetsEndpoint = 'products/search/facets'
const attributesEndpoint = 'attributes'

// pxm/api/markdownRenderer/html?languageId=${contentLanguage}`, normalizedValue
const markdownEndpoint = 'markdownRenderer/html'

const parseQueryString = (query, categorySlug = null) => {
	const params = queryString.parse(query)

	// sort
	let sort = params.sort as string
	let direction: 'asc' | 'desc' | null

	if (sort) {
		if (sort.startsWith('-')) {
			sort = sort.substring(1)
			direction = 'desc'
		} else {
			direction = 'asc'
		}

		sort = ({
			name: `attrValue_string_${ATTRIBUTE_SHORT_DESCRIPTION}_${LANGUAGE_TAG}`,
			updatedAt: 'changedOn',
			price: 'minPrice_' + currencyCode
		})[sort]

		if (sort) {
			sort = sort + ',' + direction
		}
	}

	// backend page starts from 0, svelte page starts from 1
	const page = params.page ? (params.page as unknown as number - 1) : 0

	// q - query string from search field
	const searchValue = params.q || ''

	const manufacturerId = params.brands || ''
	const supplierId = params.vendors || ''

	let attributeValues = {}
	Object.keys(params)
		.filter((param) => !['sort', 'page', 'q', 'brands', 'vendors'].includes(param))
		.forEach((param) => {
			attributeValues[param] = params[param] instanceof Array ? params[param] : [params[param]]
		})

	const hierarchyPaths = categorySlug ? [`/${categorySlug}`] : []

	return ({
		query: {
			searchValue,
			page,
			sort
		},
		searchData: {
			facetParams: {
				hierarchyPaths,
				manufacturerId,
				supplierId,
				attributeValues
			}
		}
	})
}

const stringifySearchParams = (searchParams) => {
	const queryStr = queryString.stringify(searchParams.query, {
		skipNull: true,
		skipEmptyString: true
	})
	return queryStr ? `?${queryStr}` : ''
}

const fetchFacets = async ({ searchParams, origin }) => {
	const searchData = searchParams.searchData
	const query = stringifySearchParams(searchParams)

	const brands = mapProdexaFacets(await post(
		`${productsFacetsEndpoint}/fields/manufacturerId${query}`,
		searchData,
		origin
	))

	const vendors = mapProdexaFacets(await post(
		`${productsFacetsEndpoint}/fields/supplierId${query}`,
		searchData,
		origin
	))

	const attributes = mapProdexaAttrFacets(await post(
		`${productsFacetsEndpoint}/attributes${query}`,
		searchData,
		origin
	))

	// TODO need to have only one call that will fetch attr with values
	attributes.all.key.buckets = await Promise.all(
		attributes.all.key.buckets.map((bucket) => post(
				`${productsFacetsEndpoint}/attribute-values/${bucket.key}`,
				searchData,
				origin
			)
				.then(res => res.map(mapProdexaFacet))
				.then(res => ({ ...bucket, value: { buckets: res } }))
		)
	)

	return {
		all_aggs: {
			doc_count: 1,
			brands,
			vendors,
			attributes
		}
	}
}

// Fetch all products called from the search field
export const fetchProducts = async ({ query = '', origin }: any) => {
	const searchParams = parseQueryString(query)

	try {
		const productsPage = await post(
			`${productsEndpoint}${stringifySearchParams(searchParams)}`,
			searchParams.searchData,
			origin
		)

		const facets = await fetchFacets({ searchParams, origin })

		return mapProdexaAllProducts({ ...productsPage, facets }) || []

	} catch (e) {
		error(e.status, e.data?.message || e.message)
	}
}

function normalizeValue(value) {
  const normalizedValue = value
    ? value
      .split('\n')
      .map((line) => (line.startsWith('|') ? line : `| ${line}`))
      .map((line) => (line.endsWith('|') ? line : `${line} |`))
      .join('\n')
    : value
  return normalizedValue
}

const enrichFromAttr = async (attr, to, origin) => {
  if(attr){
    to.name = attr.description || attr.shortDescriptions?.[LANGUAGE_TAG] || to._id
    to.type = attr.type
    if ('boolean' === attr.type) {
      to.value = to.value === 'true' ? 'Yes' : 'No'
    } else if ('text-table' === attr.type || 'markdown' === attr.type) {
      try {
        const normalizedValue = normalizeValue(to.value)
        const mark = await post(
          `${markdownEndpoint}?languageId=${LANGUAGE_TAG}`,
          normalizedValue,
          origin,
          {
            Accept: 'text/html',
          },
        )
        to.value = mark || to.value
      } catch (e) {
        console.log(e)
      }
    }
    to.isMultivalued = attr.isMultivalued
    if (attr.isMultivalued) {
      const m = JSON.parse(to.value)
      let ul = ''
      ul += (`<ul class="mult-value">`)
      m?.forEach((v) => {
        ul += (`<li>${v}</li>`)
      })
      ul += (`</ul>`)
      to.value = ul
    }
  }
}

// Fetch single product
export const fetchProduct = async ({ origin, slug }) => {
	try {

    // retrieve product
		const product = await getAPI(
			`product-editor/products/${slug.replace(SLUG_SEPARATOR, '/')}`,
			origin
		)
    const mappedProduct = mapProdexaProduct(product)

    // retrieve attributes
    const attrs = await getAPI(
      `product-editor/products/${slug.replace(SLUG_SEPARATOR, '/')}/attributes?language=${LANGUAGE_TAG}`,
      origin
    )
    // console.log('attrs=', attrs)
    mappedProduct?.specifications?.map((sp) => {
      let attr = attrs.attributes[sp._id]
      enrichFromAttr(attr, sp, origin)
    })

    // pxm/api/product-editor/variants/attributes?language=en-GB - retrieves all var attr - not so good
    // retrieve only variant attrs missing after retrieve attributes
    let missedVariantNamesSet = new Set()
    let missedVariantAttrMap = new Map()
    mappedProduct?.variants?.map((v) => {
      v.variantValues?.map((vv) => {
        let attr = attrs.attributes[vv._id]
        if (!attr) {
          missedVariantNamesSet.add(vv._id)
        } else {
          enrichFromAttr(attr, vv, origin)
        }
      })
    })
    if (missedVariantNamesSet.size) {
      const bliadSet = [...missedVariantNamesSet]
      await Promise.all(
        bliadSet.map(key => getAPI(
            `${attributesEndpoint}/${key}`,
            origin
          )
            .then((res) => {
              missedVariantAttrMap.set(key, res?.attribute)
              }
            )
            .catch(e => console.log(e))
        )
      )
      mappedProduct?.variants?.map((v) => {
        v.variantValues?.map((vv) => {
          if (missedVariantAttrMap.has(vv._id)) {
            enrichFromAttr(missedVariantAttrMap.get(vv._id), vv, origin)
          }
        })
      })
    }

    if(mappedProduct?.relations) {
      let relatedProducts = []
      await Promise.all(
        mappedProduct?.relations?.map(r => getAPI(
            `product-editor/products/${r.relatedCatalogId}/${r.relatedProductId}`,
            origin
          )
            .then((res) => {
                relatedProducts.push(mapProdexaProduct(res))
              }
            )
            .catch(e => console.log(e))
        )
      )
      mappedProduct.relatedProducts = relatedProducts
    }

    return mappedProduct
	} catch (e) {
		error(e.status, e.data?.message || e.message)
	}
}

// TODO ...
// Fetch products more requirements
// the same as fetchProduct
// used by routes/(product)/product/[slug]/+page.svelte
// while fetchProduct used by routes/(product)/product/[slug]/+page.ts
// this is weird and as a result we have 2 product api calls
// on the product details page
export const fetchProduct2 = fetchProduct

// Fetch products based on category called when selecting category
export const fetchProductsOfCategory = async ({ categorySlug, origin, query }) => {
	const searchParams = parseQueryString(query, categorySlug)

	try {
		const productsPage = await post(
			`${productsEndpoint}${stringifySearchParams(searchParams)}`,
			searchParams.searchData,
			origin
		)

		const products = productsPage?.content?.map((p) => mapProdexaProduct(p))
		const facets = await fetchFacets({ searchParams, origin })

		const count = productsPage?.totalElements
		const pageSize = productsPage?.size

    let category = {
      name: categorySlug,
      id: categorySlug,
      slug: categorySlug,
      link: categorySlug,
    }

    // retrieve category data
    try {
      const res = await getAPI(`classifications/${categorySlug}`, origin)
      const category1 =  mapProdexaCategoryClassification(res) || {}
      category = {...category1}
    } catch (e) {
      //error(e.status, e.data?.message || e.message)
      console.log(e)
    }

		const err = !productsPage?.totalElements ? 'No result Not Found' : null
		const currentPage = productsPage?.totalPages + 1

		return {
			category,
			count,
			currentPage,
			err,
			pageSize,
			products,
			facets: facets as unknown as string
		}
	} catch (e) {
		error(e.status, e.data?.message || e.message)
	}
}

// Fetch next product
export const fetchNextPageProducts = async ({ categorySlug, nextPage, searchParams: query = {}, origin }) => {
	const searchParams = parseQueryString(query)
	searchParams.query.page = nextPage - 1

	try {
		const productsPage = await post(
			`${productsEndpoint}${stringifySearchParams(searchParams)}`,
			searchParams.searchData,
			origin
		)

		const nextPageData = productsPage.content.map((p) => mapProdexaProduct(p))
		const facets = await fetchFacets({ searchParams: searchParams, origin })

		return {
			category: categorySlug,
			count: productsPage.totalElements,
			estimatedTotalHits: productsPage.totalElements,
			facets,
			nextPageData
		}
	} catch (e) {
		error(e.status, e.data?.message || e.message)
	}
}

export const fetchReels = async ({}: any) => {

	try {
		let res: AllProducts | {} = {}

		// TODO ...

		return res || {}
	} catch (e) {
		error(e.status, e.data?.message || e.message)
	}
}

export declare const fetchRelatedProducts: ({ origin, storeId, categorySlug, pid, sid }: {
	origin: any;
	storeId: any;
	categorySlug: any;
	pid: any;
	sid?: any;
}) => Promise<any>
