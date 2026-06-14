import os
from flask import Flask

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-in-production")


@app.route("/")
def index():
    return "<h1>The Butterfly Effect</h1><p>Server is running.</p>"


if __name__ == "__main__":
    app.run(debug=True)
