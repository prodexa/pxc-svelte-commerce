import { currencyCode } from '$lib/config'
import type { AllProducts, Brand, Product } from '$lib/types'

export const LANGUAGE_TAG = 'en-GB'
export const SLUG_SEPARATOR = '___'

export const ATTRIBUTE_SHORT_DESCRIPTION = 'ShortDescription'
const ATTRIBUTE_LONG_DESCRIPTION = 'LongDescription'
const excludeFromSpecifications = [ATTRIBUTE_SHORT_DESCRIPTION, ATTRIBUTE_LONG_DESCRIPTION]

const documentViewTypes = [
	'preview',
	'product_image',
	'detail_view',
	// 'data_sheet', // exclude non images
	'others'
]

export const mapProdexaAllProducts = (productsPage: any): AllProducts => {
	const products = productsPage?.content?.map((p) => mapProdexaProduct(p))
	return {
		count: productsPage?.totalElements,
		currentPage: productsPage?.number + 1,
		pageSize: productsPage?.size,
		limit: productsPage?.size,
		// TODO (gor) why both, the 'data' and 'products' are needed? they are the same!
		products, data: products,
		facets: productsPage?.facets
	}
}

export const mapProdexaProduct = (product: any) => {
	if (!product) {
		return {}
	}

	const status = product.statusId

	const attributeValues = product.values

	const name = attributeValues?.[ATTRIBUTE_SHORT_DESCRIPTION]?.[LANGUAGE_TAG]
	const description = attributeValues?.[ATTRIBUTE_LONG_DESCRIPTION]?.[LANGUAGE_TAG]

	const images = product?.productDocuments
		?.filter((doc) => documentViewTypes.includes(doc.documentViewTypeId))
		?.map((doc) => `/prodexa-img/${doc.path}`)
		?.filter((path, index, pathes) => pathes.indexOf(path) === index)
	const img = images?.[0]

	// TODO what price to use, product has many prices
	// const price = product.prices?.[0]?.price
	const price = product.prices
		?.filter((price: any) => price.currencyId === currencyCode)
		?.sort((a, b) => a.price - b.price)
		?.map((price: any) => price.price)
		?.[0]

	const brand: Brand = {
		_id: product.manufacturerId,
		name: product.manufacturerId,
		slug: product.manufacturerId,
		active: false
	}

	// TODO use groups hierarchy for categoryPool
	const classificationId = product.productGroups?.[0]?.classificationId
	const categoryPool = [{
		id: classificationId,
		name: classificationId,
		slug: classificationId
	}]

	const specifications = Object.entries(attributeValues)
		.filter(([attributeId]) => !excludeFromSpecifications.includes(attributeId))
		.map(([attributeId, value]) => {
			if (typeof value === 'object' && value !== null) {
				value = value[LANGUAGE_TAG] ? value[LANGUAGE_TAG] : value
			}

			if (typeof value === 'object' && value !== null) {
				value = JSON.stringify(value)
			}

			return ({
				_id: attributeId,
				name: attributeId, // to be enriched
				value: value?.toString(),
				active: true
			})
		})

	const slug = product.catalogId + SLUG_SEPARATOR + product.productId

  const variantsEntries = Object.entries(product.variantValues)
  const variants = variantsEntries?.map((v) => {
    const variantEntries = Object.entries(v[1])
    const variantValues = variantEntries.map(([attributeId, value]) => {
        if (typeof value === 'object' && value !== null) {
          value = value[LANGUAGE_TAG] ? value[LANGUAGE_TAG] : value
        }
        if (typeof value === 'object' && value !== null) {
          value = JSON.stringify(value)
        }
        return ({
          _id: attributeId,
          name: attributeId,  // to be enriched
          value: value?.toString(),
          active: true
        })
      })
    return {
      id: v[0],
      title: v[0],
      variantValues,
    }
  }) || []

  const relations = product.relations
  const relatedProducts = [] // to be enriched

  const prod: Product = {
		_id: slug,
		id: slug,
		slug,
		categoryPool,
		img,
		images,
		status,
		name,
		description,
		price,
		brand,
		specifications,
		active: true,
		hasStock: true,
    variants,
    relatedProducts,
    relations
  }
  return prod
}

export const mapProdexaCategoryClassification = (c: any) => {
	if (!c) {
		return {}
	}
  // console.log('c=', c)
	return {
		id: c.classificationId,
		name: c.fallbackDescription || c.classificationId,
		slug: c.classificationId,
		link: c.classificationId,
		children: c.category_children
			? c.category_children.map((i: any) => {
				if (i) return mapProdexaCategoryClassification(i)
			})
			: [],
    img:  c.documentUrl1 ? `/prodexa-img/${c.documentUrl1}` : '',
    orderNo: c.orderNo,
	}
}

export const mapProdexaFacets = (f: any) => {
	if (!f) {
		return {}
	}

	const buckets = f.map((p) => mapProdexaFacet(p))
	return {
		doc_count: 1,
		all: {
			buckets
		}
	}
}

export const mapProdexaFacet = (f: any) => f ? {
	key: f.val?.toString(),
	doc_count: f.count,
  label: f.label
} : {}

export const mapProdexaAttrFacets = (f: any) => {
	if (!f) {
		return {}
	}

	const buckets = f.map((p) => mapProdexaAttrFacet(p))
	return {
		doc_count: 1,
		all: {
			key: {
				buckets
			}
		}
	}
}

export const mapProdexaAttrFacet = (f: any) => f ? {
	key: f.val,
	doc_count: f.count,
  label: f.label,
	value: {
		buckets: []
	}
} : {}

export const mapProdexaAutocomplete = (prodexaProduct: any) => {
	const product = mapProdexaProduct(prodexaProduct)
	return ({
		count: 1,
		type: 'products',
		slug: product.slug,
		key: product.name || prodexaProduct.productId,
		img: product.img
	})
}

export const mapProdexaAutocompleteNonProduct = (f: any) => {
  return ({
    count: f.count,
    type: 'search',
    key: f.val
  })
}
