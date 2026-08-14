import { useLocation } from 'react-router'

export const useQuery = () => {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)

  const query: { [key: string]: string } = {}
  for (let [key, value] of searchParams.entries()) query[key] = value

  return query
}
