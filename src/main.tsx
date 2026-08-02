import { router } from '@/router'
import '@icon-park/react/styles/index.css'
import '@unocss/reset/tailwind.css'
// import "ono-react-element/index.css"
import 'ono-react-element/global.css'
import 'ono-react-element/style/Button.css'
import 'ono-react-element/style/Switch.css'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from 'react-router'
import 'virtual:uno.css'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
)
