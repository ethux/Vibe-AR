#!/usr/bin/env python3
"""Simple web server that serves a hello world page."""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

class HelloHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Hello World</title>
                <style>
                    body {
                        font-family: 'Arial', sans-serif;
                        background: linear-gradient(135deg, #ffa500 0%, #ff8c00 50%, #ff7f50 100%);
                        height: 100vh;
                        margin: 0;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        text-align: center;
                        color: #333;
                    }
                    .container {
                        background: white;
                        padding: 40px;
                        border-radius: 15px;
                        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
                        max-width: 600px;
                        animation: fadeIn 1s ease-in-out;
                        border: 3px solid #ff8c00;
                    }
                    h1 {
                        background: linear-gradient(90deg, #ff8c00, #ffa500, #ff7f50);
                        -webkit-background-clip: text;
                        -webkit-text-fill-color: transparent;
                        background-clip: text;
                        font-size: 3em;
                        margin-bottom: 20px;
                        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
                    }
                    p {
                        font-size: 1.2em;
                        color: #ff8c00;
                        font-weight: bold;
                    }
                    @keyframes fadeIn {
                        from { opacity: 0; transform: translateY(-20px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>Mistral Hackathon!</h1>
                    <p>Join the AI revolution with Mistral's cutting-edge technology.</p>
                    <p style="margin-top: 15px; font-size: 0.9em;">Build innovative solutions and win amazing prizes!</p>
                </div>
            </body>
            </html>
            """
            self.wfile.write(html.encode())
        else:
            super().do_GET()

def run(server_class=HTTPServer, handler_class=HelloHandler, port=8000):
    server_address = ('', port)
    httpd = server_class(server_address, handler_class)
    print(f'Serving on port {port}...')
    httpd.serve_forever()

if __name__ == '__main__':
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print("Invalid port number")
            sys.exit(1)
    run(port=port)