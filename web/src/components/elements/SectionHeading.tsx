export default function SectionHeading({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-4">
      <h2
        className="whitespace-nowrap text-base font-semibold"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {title}
      </h2>
      <div
        className="flex-1"
        style={{ borderTop: '1px dashed var(--color-accent-green)' }}
      />
    </div>
  )
}
