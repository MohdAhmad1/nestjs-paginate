import { SelectQueryBuilder } from 'typeorm'

export function checkIsArray(qb: SelectQueryBuilder<unknown>, propertyName: string): boolean {
    if (!qb || !propertyName) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata.findColumnWithPropertyName(propertyName)?.isArray
}
