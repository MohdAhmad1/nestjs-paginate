import { mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { getQueryUrlComponents } from 'utils/get-query-url-components'
import { NestJsPaginate } from '../paginate'
import { Paginated } from '../types'

export function buildLinks(qb: NestJsPaginate<any>, totalItems: number): Paginated<any>['links'] {
    const limit = qb.paginationLimit
    const page = qb.query.page > 0 ? qb.query.page : 1

    const sortByQuery = qb.sortableColumns?.map((order) => `&sortBy=${order.join(':')}`).join('')
    const searchQuery = qb.query.search ? `&search=${qb.query.search}` : ''

    const searchByQuery =
        qb.query.searchBy?.length && !qb.config.ignoreSearchByInQueryParam
            ? qb.searchableColumns.map((column) => `&searchBy=${column}`).join('')
            : ''

    const selectQuery = qb.isQuerySelected ? `&select=${qb.selectableColumns?.join(',')}` : ''

    const filterQuery = qb.query.filter
        ? '&' +
          stringify(
              mapKeys(qb.query.filter, (_param, name) => 'filter.' + name),
              '&',
              '=',
              { encodeURIComponent: (str) => str }
          )
        : ''

    const options = `&limit=${limit}${sortByQuery}${searchQuery}${searchByQuery}${selectQuery}${filterQuery}`

    const totalPages = qb.isPaginated ? Math.ceil(totalItems / limit) : 1

    let path: string = null

    if (qb.query.path !== null) {
        // `query.path` does not exist in RPC/WS requests and is set to null then.
        const { queryOrigin, queryPath } = getQueryUrlComponents(qb.query.path)

        switch (true) {
            case qb.config.relativePath:
                path = queryPath

                break
            case Boolean(qb.config.origin):
                path = qb.config.origin + queryPath

                break

            default:
                path = queryOrigin + queryPath
                break
        }
    }

    const buildLink = (p: number): string => path + '?page=' + p + options

    const links = {} as Paginated<any>['links']

    if (path === null) return links

    links.current = buildLink(page)

    if (Number(page) !== 1) {
        links.first = buildLink(1)
    }

    if (page - 1 > 0) {
        links.previous = buildLink(page - 1)
    }

    if (page + 1 <= totalPages) {
        links.next = buildLink(page + 1)
    }

    if (page !== totalPages && totalItems) {
        links.last = buildLink(totalPages)
    }

    return links
}
