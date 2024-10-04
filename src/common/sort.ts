import { ServiceUnavailableException } from '@nestjs/common'
import { NestJsPaginate } from '../paginate'
import { logger, extractVirtualProperty, getPropertiesByColumnName } from '../utils'
import { fixColumnAlias } from 'utils/fix-column-alias'
import { checkIsEmbedded } from 'utils/is-embedded'
import { checkIsRelation } from 'utils/is-relation'

function isMariaDbOrMySql(dbType: string) {
    return dbType === 'mariadb' || dbType === 'mysql'
}

function getNullSorting(isMMDb: boolean, qb: NestJsPaginate<any>) {
    let nullSort: string | undefined

    if (qb.config.nullSort) {
        if (isMMDb) {
            nullSort = qb.config.nullSort === 'last' ? 'IS NULL' : 'IS NOT NULL'
        } else {
            nullSort = qb.config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
        }
    }

    return nullSort
}

export function addSort<T>(qb: NestJsPaginate<T>) {
    const queryBuilder = qb.queryBuilder

    const isMMDb = isMariaDbOrMySql(queryBuilder.connection.options.type)
    const nullSort = getNullSorting(isMMDb, qb)

    if (qb.sortableColumns.length < 1) {
        const message = "Missing required 'sortableColumns' config."
        logger.debug(message)
        throw new ServiceUnavailableException(message)
    }

    for (const order of qb.sortableColumns) {
        const columnProperties = getPropertiesByColumnName(order[0])
        const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
        const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
        const isEmbedded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)

        let alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbedded)

        if (isMMDb) {
            if (isVirtualProperty) {
                alias = `\`${alias}\``
            }

            if (nullSort) {
                queryBuilder.addOrderBy(`${alias} ${nullSort}`)
            }

            queryBuilder.addOrderBy(alias, order[1])

            continue
        }

        if (isVirtualProperty) {
            alias = `"${alias}"`
        }

        queryBuilder.addOrderBy(alias, order[1], nullSort as 'NULLS FIRST' | 'NULLS LAST' | undefined)
    }
}
