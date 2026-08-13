export { defineConfig } from './autoRouter.tsx'
import { createBrowserRouter } from 'react-router'
import { routes } from './autoRouter.tsx'

export const router = createBrowserRouter(routes)
