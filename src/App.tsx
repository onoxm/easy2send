import { useAutostart, useGetIP, useNotification, usePort } from '@/hooks'

function App() {
  const ipv4 = useGetIP()
  const [port, resetPort] = usePort(ipv4)
  const [autostart, toggleAutostart] = useAutostart()
  const sendNotification = useNotification()

  return (
    <main className="w-screen h-screen">
      <p>
        ip: {ipv4} port: {port}
      </p>

      <button
        className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
        onClick={() => sendNotification('ONO', 'This is a notification')}
      >
        Send Notification
      </button>

      <button
        className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
        onClick={resetPort}
      >
        Reset Port
      </button>

      <button
        className="bg-blue-500 text-white p-1 rounded-sm cursor-pointer"
        onClick={toggleAutostart}
      >
        {autostart ? 'Stop' : 'Start'} Autostart
      </button>
    </main>
  )
}

export default App
