import { FindOperator } from 'typeorm'

export function isFindOperator<T>(value: unknown | FindOperator<T>): value is FindOperator<T> {
    if (value instanceof FindOperator) return true
    try {
        if (Object.getPrototypeOf(value).constructor.name === 'FindOperator') return true
        return typeof value === 'object' && '_type' in value && '_value' in value
    } catch {
        return false
    }
}
