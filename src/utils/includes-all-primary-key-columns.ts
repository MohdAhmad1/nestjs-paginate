import { SelectQueryBuilder } from 'typeorm'

export function includesAllPrimaryKeyColumns(qb: SelectQueryBuilder<unknown>, propertyPath: string[]): boolean {
    if (!qb || !propertyPath) {
        return false
    }

    return qb.expressionMap.mainAlias?.metadata?.primaryColumns
        .map((column) => column.propertyPath)
        .every((column) => propertyPath.includes(column))
}
