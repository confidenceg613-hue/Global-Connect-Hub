import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const lines =
          typeof description === "string"
            ? description.split("\n").filter(Boolean)
            : null;

        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {lines && lines.length > 0 && (
                <ToastDescription asChild>
                  <div className="space-y-0.5">
                    {lines.map((line, i) => (
                      <p key={i} className="text-sm opacity-90">{line}</p>
                    ))}
                  </div>
                </ToastDescription>
              )}
              {!lines && description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
