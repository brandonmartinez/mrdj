import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  title?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Render error caught by ErrorBoundary', error, info);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-lg">
          <p className="text-3xl" aria-hidden>⚠️</p>
          <h1 className="mt-3 text-xl font-semibold">{this.props.title ?? 'Something went wrong'}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A part of mrdj failed to render. Try again, or reload the app if the problem continues.
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={this.retry}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
