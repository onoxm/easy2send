import { createNewWindow } from '@/api/tauri'
import { Layout } from '@/components'
import useStore from '@/store'
import { Button } from 'ono-react-element'
import { useState } from 'react'
import { Link } from 'react-router'

export default () => {
  const { ip, port } = useStore(['ip', 'port'])
  const [isSend, setIsSend] = useState(false)

  return (
    <Layout>
      <div className="flex gap-2">
        {!isSend ? (
          <>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-md"
              onClick={() => setIsSend(true)}
            >
              发送端
            </button>
            <Link
              to="/receive"
              className="bg-green-500 text-white px-4 py-2 rounded-md"
            >
              接收端
            </Link>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded-md"
              onClick={() => {
                createNewWindow('settings', {
                  url: '/settings',
                  width: 600,
                  height: 400
                })
              }}
            >
              设置
            </button>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              className="bg-blue-500 text-white px-4 py-2 rounded-md"
              onClick={() => setIsSend(false)}
            >
              返回
            </Button>
            <h3>输入接收端ip</h3>

            <input
              className="border border-[#333]"
              type="text"
              value={ip || ''}
              onChange={e => useStore.setState({ ip: e.target.value })}
            />

            <h3>输入接收端口</h3>

            <input
              className="border border-[#333]"
              type="text"
              value={port || ''}
              onChange={e =>
                useStore.setState({ port: Number(e.target.value) })
              }
            />

            <Link
              className="bg-blue-500 text-white px-4 py-2 rounded-md"
              to="/send"
            >
              启动发送端
            </Link>
          </div>
        )}
      </div>
    </Layout>
  )
}
