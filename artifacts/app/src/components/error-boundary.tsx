import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: string, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
  stack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "", stack: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? (error.stack ?? "") : "";
    return { hasError: true, message, stack };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, message: "", stack: "" });

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.message, this.reset);
      }
      return (
        <div className="min-h-[50vh] bg-background flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-4xl">⚠️</div>
            <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
            <div className="bg-muted rounded-lg p-3 text-left">
              <p className="text-xs font-mono text-red-400 break-all leading-relaxed">
                {this.state.message || "Unknown error"}
              </p>
              {this.state.stack && (
                <p className="text-[10px] font-mono text-muted-foreground mt-2 break-all leading-relaxed line-clamp-4">
                  {this.state.stack.split("\n").slice(1, 4).join("\n")}
                </p>
              )}
            </div>
            <div className="flex gap-3 justify-center">
              <button
                className="px-4 py-2 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90"
                onClick={this.reset}
              >
                Try again
              </button>
              <button
                className="px-4 py-2 bg-muted text-foreground text-sm rounded-lg hover:opacity-90"
                onClick={() => window.location.reload()}
              >
                Reload page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
