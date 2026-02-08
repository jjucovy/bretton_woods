        // Error Boundary Component
        class ErrorBoundary extends React.Component {
          constructor(props) {
            super(props);
            this.state = { hasError: false, error: null, errorInfo: null };
          }

          static getDerivedStateFromError(error) {
            return { hasError: true };
          }

          componentDidCatch(error, errorInfo) {
            console.error('!!! REACT ERROR CAUGHT !!!');
            console.error('Error:', error);
            console.error('Error Info:', errorInfo);
            this.setState({ error, errorInfo });
          }

          render() {
            if (this.state.hasError) {
              return (
                <div className="container">
                  <div className="card">
                    <h2 style={{ color: '#dc2626' }}>⚠️ Something Went Wrong</h2>
                    <p>The app encountered an error. Check the console for details.</p>
                    <pre style={{
                      background: '#f8fafc',
                      padding: '10px',
                      overflow: 'auto',
                      fontSize: '0.75rem',
                      textAlign: 'left'
                    }}>
                      {this.state.error && this.state.error.toString()}
                      {'\n\n'}
                      {this.state.errorInfo && this.state.errorInfo.componentStack}
                    </pre>
                    <button
                      onClick={() => window.location.reload()}
                      className="btn-primary"
                      style={{ marginTop: '20px' }}
                    >
                      Reload Page
                    </button>
                  </div>
                </div>
              );
            }

            return this.props.children;
          }
        }

window.ErrorBoundary = ErrorBoundary;
