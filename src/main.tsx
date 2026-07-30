import { router } from '@/router'
import '@unocss/reset/tailwind.css'
import 'ono-react-element/dist/index.css'
// import "ono-react-element/index.css"
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import 'virtual:uno.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
