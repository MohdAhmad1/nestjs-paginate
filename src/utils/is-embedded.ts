import { SelectQueryBuilder } from 'typeorm'

export function checkIsEmbedded(qb: SelectQueryBuilder<unknown>, propertyPath: string): boolean {
    if (!qb || !propertyPath) {
        return false
    }
    return !!qb?.expressionMap?.mainAlias?.metadata?.hasEmbeddedWithPropertyPath(propertyPath)
}
