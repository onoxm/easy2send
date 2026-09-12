import { useSearchParams } from 'react-router'

export const useQuery = () => {
  const [searchParams] = useSearchParams()

  const query: { [key: string]: string } = {}
  for (let [key, value] of searchParams.entries()) query[key] = value

  return query
}
