import { FindOptionsRelationByString, FindOptionsRelations, FindOptionsWhere } from 'typeorm'
import { FilterOperator, FilterSuffix } from './common/filter'

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

/**
 * Joins 2 keys as `K`, `K.P`, `K.(P` or `K.P)`
 * The parenthesis notation is included for embedded columns
 */
type Join<K, P> = K extends string
    ? P extends string
        ? `${K}${'' extends P ? '' : '.'}${P | `(${P}` | `${P})`}`
        : never
    : never

/**
 * Get the previous number between 0 and 10. Examples:
 *   Prev[3] = 2
 *   Prev[0] = never.
 *   Prev[20] = 0
 */
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, ...0[]]

/**
 * Unwrap Promise<T> to T
 */
type UnwrapPromise<T> = T extends Promise<infer U> ? UnwrapPromise<U> : T

/**
 * Unwrap Array<T> to T
 */
type UnwrapArray<T> = T extends Array<infer U> ? UnwrapArray<U> : T

/**
 * Find all the dotted path properties for a given column.
 *
 * T: The column
 * D: max depth
 */
//                                            v Have we reached max depth?
export type Column<T, D extends number = 2> = [D] extends [never]
    ? // yes, stop recursing
      never
    : // Are we extending something with keys?
      T extends Record<string, any>
      ? {
            // For every keyof T, find all possible properties as a string union
            [K in keyof T]-?: K extends string
                ? // Is it string or number (includes enums)?
                  T[K] extends string | number
                    ? // yes, add just the key
                      `${K}`
                    : // Is it a Date?
                      T[K] extends Date
                      ? // yes, add just the key
                        `${K}`
                      : // no, is it an array?
                        T[K] extends Array<infer U>
                        ? // yes, unwrap it, and recurse deeper
                          `${K}` | Join<K, Column<UnwrapArray<U>, Prev[D]>>
                        : // no, is it a promise?
                          T[K] extends Promise<infer U>
                          ? // yes, try to infer its return type and recurse
                            U extends Array<infer V>
                              ? `${K}` | Join<K, Column<UnwrapArray<V>, Prev[D]>>
                              : `${K}` | Join<K, Column<UnwrapPromise<U>, Prev[D]>>
                          : // no, we have no more special cases, so treat it as an
                            // object and recurse deeper on its keys
                            `${K}` | Join<K, Column<T[K], Prev[D]>>
                : never
            // Join all the string unions of each keyof T into a single string union
        }[keyof T]
      : ''

export type RelationColumn<T> = Extract<
    Column<T>,
    {
        [K in Column<T>]: K extends `${infer R}.${string}` ? R : never
    }[Column<T>]
>

export type Order<T> = [Column<T>, 'ASC' | 'DESC']
export type SortBy<T> = Order<T>[]
export type ColumnProperties = { propertyPath?: string; propertyName: string; isNested: boolean; column: string }
