import { create } from 'zustand'
import {
  createJSONStorage,
  devtools,
  persist,
  subscribeWithSelector
} from 'zustand/middleware'
import { useShallow } from 'zustand/shallow'

const initialState = {
  theme: 'light',
  autostart: false,
  version: '0.0.0'
}

export type StateType = typeof initialState

const isSameValue = (arr: string[]) => new Set(arr).size !== arr.length

const designateStateMethods: (
  state: StateType,
  designateStates: Partial<keyof StateType>[]
) => Pick<StateType, (typeof designateStates)[number]> = (
  state,
  designateStates
) => {
  if (isSameValue(designateStates))
    throw new Error('Each item in designateStates must be unique')

  return designateStates
    .map(key => ({ [key]: state[key] }))
    .reduce((acc, current) => ({ ...acc, ...current }), {}) as Pick<
    StateType,
    (typeof designateStates)[number]
  >
}

const useStore = create<StateType>()(
  devtools(
    subscribeWithSelector(
      persist(() => initialState, {
        name: 'ono-storage',
        partialize: state =>
          designateStateMethods(state, ['version', 'autostart', 'theme']),
        storage: createJSONStorage(() => localStorage)
      })
    )
  )
)

type DesignateMethodType = <T extends Partial<keyof StateType>>(
  designateStates: T[]
) => Pick<StateType, T>

export const useDesignateStore: DesignateMethodType = designateStates =>
  useStore(useShallow(state => designateStateMethods(state, designateStates)))

export default useStore
