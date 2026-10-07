import { chainClassNames, OnoSelect } from 'ono-react-element'

interface SelectProps {
  selectClassName?: string
  optionsClassName?: string
  defaultValue?: string | number
  notFoundContent?: string
  options: { label: string; value: string | number }[]
  filterOption?: boolean
  fontFamily?: (value: string) => string | undefined
  onChange?: (value: string | number) => void
}

export const Select = ({
  selectClassName,
  optionsClassName,
  defaultValue,
  notFoundContent,
  options,
  fontFamily,
  filterOption,
  onChange
}: SelectProps) => {
  return (
    <OnoSelect
      selectClassName={chainClassNames(
        'input py-[7.5px] pl-[11px] pr-[9px] border border-line-200 bg-surface-base text-ink-900 text-card/[1.4615]',
        selectClassName
      )}
      optionsClassName={chainClassNames(
        'py-1 border border-line-200 bg-surface-base gap-1 flex flex-col',
        optionsClassName
      )}
      defaultValue={defaultValue}
      filterOption={filterOption}
      isShowArrow={false}
      notFoundContent={
        notFoundContent && (
          <p className="p-2 text-body/[1.4167] text-ink-400">
            {notFoundContent}
          </p>
        )
      }
      options={options}
      onChange={onChange}
    >
      {(option, selected) => (
        <span
          className={chainClassNames(
            'py-1.5 px-2.5 text-ink-900 text-card/4.75 hover:bg-line-100 block rounded-sm',
            selected ? 'bg-brand-50 text-brand-600' : ''
          )}
          style={{
            fontFamily: fontFamily?.(option.value + '')
          }}
        >
          {option.label}
        </span>
      )}
    </OnoSelect>
  )
}
