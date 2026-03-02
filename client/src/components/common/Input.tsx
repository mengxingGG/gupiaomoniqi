import { InputHTMLAttributes, forwardRef, ReactNode, useId } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
  fullWidth?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      fullWidth = false,
      className = '',
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = useId()
    const inputId = id || generatedId

    const baseInputStyles =
      'px-3 py-2 border rounded-lg transition-colors duration-200 focus:outline-none focus:ring-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white'

    const normalStyles =
      'border-gray-300 dark:border-gray-600 focus:border-blue-500 focus:ring-blue-500'

    const errorStyles = 'border-red-500 focus:border-red-500 focus:ring-red-500'

    const widthClass = fullWidth ? 'w-full' : ''

    return (
      <div className={`${widthClass}`}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`${baseInputStyles} ${error ? errorStyles : normalStyles} ${
              leftIcon ? 'pl-10' : ''
            } ${rightIcon ? 'pr-10' : ''} ${fullWidth ? 'w-full' : ''} ${className}`}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="mt-1 text-sm text-red-500">{error}</p>}
        {hint && !error && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{hint}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'

export default Input
