import { createNewWindow } from '@/api/tauri'
import { Layout } from '@/components'
import useStore from '@/store'
import { SettingTwo } from '@icon-park/react'
import { Button } from 'ono-react-element'
import { useState } from 'react'
import { Link } from 'react-router'

export default () => {
  const { ip, port } = useStore(['ip', 'port'])
  const [isSend, setIsSend] = useState(false)

  return (
    <Layout>
      <div className="flex gap-2 w-full flex-1 justify-center items-center relative">
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
              className="little_btn absolute top-2 right-2"
              onClick={() => {
                createNewWindow("settings", {
                  url: "/settings",
                  width: 600,
                  height: 400,
                });
              }}
            >
              <SettingTwo
                theme="outline"
                size={20}
                fill="#333"
                strokeWidth={3}
              />
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
              value={ip || ""}
              onChange={(e) => useStore.setState({ ip: e.target.value })}
            />

            <h3>输入接收端口</h3>

            <input
              className="border border-[#333]"
              type="text"
              value={port || ""}
              onChange={(e) =>
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
  );
}
