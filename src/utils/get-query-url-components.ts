export function getQueryUrlComponents(path: string): { queryOrigin: string; queryPath: string } {
    const r = new RegExp('^(?:[a-z+]+:)?//', 'i')
    let queryOrigin = ''
    let queryPath = ''
    if (r.test(path)) {
        const url = new URL(path)
        queryOrigin = url.origin
        queryPath = url.pathname
    } else {
        queryPath = path
    }
    return { queryOrigin, queryPath }
}
