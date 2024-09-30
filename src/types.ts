import { FindOptionsRelationByString, FindOptionsRelations, FindOptionsWhere } from 'typeorm'
import { Column, RelationColumn, SortBy } from './helper'
import { FilterOperator, FilterSuffix } from './filter'

export class Paginated<T> {
    data: T[]
    meta: {
        itemsPerPage: number
        totalItems: number
        currentPage: number
        totalPages: number
        sortBy: SortBy<T>
        searchBy: Column<T>[]
        search: string
        select: string[]
        filter?: {
            [column: string]: string | string[]
        }
    }
    links: {
        first?: string
        previous?: string
        current: string
        next?: string
        last?: string
    }
}

export enum PaginationType {
    LIMIT_AND_OFFSET = 'limit',
    TAKE_AND_SKIP = 'take',
}

export interface PaginateConfig<T> {
    relations?: FindOptionsRelations<T> | RelationColumn<T>[] | FindOptionsRelationByString
    sortableColumns: Column<T>[]
    nullSort?: 'first' | 'last'
    searchableColumns?: Column<T>[]
    // see https://github.com/microsoft/TypeScript/issues/29729 for (string & {})
    // eslint-disable-next-line @typescript-eslint/ban-types
    select?: (Column<T> | (string & {}))[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]
    filterableColumns?: {
        // see https://github.com/microsoft/TypeScript/issues/29729 for (string & {})
        // eslint-disable-next-line @typescript-eslint/ban-types
        [key in Column<T> | (string & {})]?: (FilterOperator | FilterSuffix)[] | true
    }
    loadEagerRelations?: boolean
    withDeleted?: boolean
    paginationType?: PaginationType
    relativePath?: boolean
    origin?: string
    ignoreSearchByInQueryParam?: boolean
    ignoreSelectInQueryParam?: boolean
}

export enum PaginationLimit {
    NO_PAGINATION = -1,
    COUNTER_ONLY = 0,
    DEFAULT_LIMIT = 20,
    DEFAULT_MAX_LIMIT = 100,
}
