import { selectProperties } from 'ono-react-element'
import { createStoreHook } from '@onoxm/zustand-tools'
import { create } from 'zustand'
import {
  createJSONStorage,
  devtools,
  persist,
  subscribeWithSelector
} from 'zustand/middleware'

const initialState = {
  theme: 'light',
  ip: '',
  port: 0,
  savePath: '',
  version: '0.0.0',
  autoCheckUpdate: true
}

export type StateType = typeof initialState

const useStore = createStoreHook(
  create<StateType>()(
    devtools(
      subscribeWithSelector(
        persist(() => initialState, {
          name: 'ono-storage',
          partialize: state =>
            selectProperties(state, [
              'version',
              'theme',
              'savePath',
              'autoCheckUpdate'
            ]),
          storage: createJSONStorage(() => localStorage)
        })
      )
    )
  )
)

export default useStore
