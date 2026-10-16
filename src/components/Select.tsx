import { chainClassNames, OnoSelect } from 'ono-react-element'

interface SelectProps<T> {
  className?: string
  defaultValue?: NoInfer<T>
  notFoundContent?: string
  options: { label: string; value: T }[]
  showOptionEntries?: number
  filterOption?: boolean
  fontFamily?: (value: string) => string | undefined
  onChange?: (value: T) => void
}

export const Select = <T = string,>({
  className,
  defaultValue,
  notFoundContent,
  options,
  showOptionEntries,
  fontFamily,
  filterOption,
  onChange
}: SelectProps<T>) => {
  return (
    <OnoSelect
      classNames={{
        select: chainClassNames(
          'input py-[7.5px] pl-[11px] pr-[9px] border border-line-200 bg-surface-base text-ink-900 text-card/[1.4615]',
          className
        ),
        panel: 'border border-line-200 bg-surface-base gap-1 flex flex-col'
      }}
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
      showOptionEntries={showOptionEntries}
    >
      {(option, selected, isCursor) => (
        <span
          className={chainClassNames(
            'py-1.5 px-2.5 text-ink-900 text-card/4.75 block rounded-sm',
            selected ? 'bg-brand-50 text-brand-600' : '',
            isCursor && !selected ? 'bg-line-100' : ''
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
