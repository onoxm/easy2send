import { router } from '@/router'
import '@unocss/reset/tailwind.css'
import 'ono-react-element/index.css'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import './index.css'
import 'virtual:uno.css'
import 'overlayscrollbars/overlayscrollbars.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
