import { downloadCSV } from '@/utils/export'

interface CSVButtonProps {
  headers: string[]
  rows: (string | number)[][]
  filename: string
}

export default function CSVButton({ headers, rows, filename }: CSVButtonProps) {
  return (
    <button
      onClick={() => downloadCSV(headers, rows, filename)}
      className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-100"
      style={{
        border: '1px solid var(--color-border-subtle)',
        color: 'var(--color-text-secondary)',
      }}
    >
      Export CSV
    </button>
  )
}
