from flask import Flask, jsonify, request, send_from_directory
import json
import os

app = Flask(__name__)
DATA_FILE = "data.json"

def load_data():
    if not os.path.exists(DATA_FILE):
        return {"matches": []}
    with open(DATA_FILE, "r") as f:
        return json.load(f)

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)

@app.route("/")
def serve_index():
    return send_from_directory(".", "index.html")

@app.route("/style.css")
def serve_css():
    return send_from_directory(".", "style.css")

@app.route("/script.js")
def serve_js():
    return send_from_directory(".", "script.js")

@app.route("/api/data", methods=["GET"])
def get_data():
    return jsonify(load_data())

@app.route("/api/data", methods=["POST"])
def set_data():
    data = request.get_json()
    save_data(data)
    return jsonify({"status": "ok"})

if __name__ == "__main__":
    app.run(debug=True, port=5000)