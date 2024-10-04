import { Repository } from 'typeorm'

export function isRepository<T>(repo: unknown | Repository<T>): repo is Repository<T> {
    if (repo instanceof Repository) return true
    try {
        if (Object.getPrototypeOf(repo).constructor.name === 'Repository') return true
        return typeof repo === 'object' && !('connection' in repo) && 'manager' in repo
    } catch {
        return false
    }
}
