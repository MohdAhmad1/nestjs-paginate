export function positiveNumberOrDefault(value: number | undefined, defaultValue: number, minValue: 0 | 1 = 0) {
    if (value === undefined || value < minValue) {
        return defaultValue
    }

    return value
}
