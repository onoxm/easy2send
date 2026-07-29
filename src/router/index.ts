export { defineConfig } from './autoRouter'
import { createBrowserRouter } from 'react-router'
import { routes } from './autoRouter'

export const router = createBrowserRouter(routes)
