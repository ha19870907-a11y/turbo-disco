"""公開リポジトリ・GitHub Pages に置くデータをパスワードで暗号化する。

環境変数 BOATRACE_PASSWORD があれば、書き出す JSON を AES-256-GCM で暗号化する。
鍵はパスワードから PBKDF2-SHA256 で作る（ブラウザの WebCrypto でも同じ手順で復号できる）。
"""
import base64
import json
import os

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ITERATIONS = 200_000
_keys = {}


def password():
    return os.environ.get("BOATRACE_PASSWORD") or None


def _key(pw, salt):
    k = (pw, salt)
    if k not in _keys:
        kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS)
        _keys[k] = kdf.derive(pw.encode("utf-8"))
    return _keys[k]


def is_encrypted(obj):
    return isinstance(obj, dict) and obj.get("enc") == "aes-gcm"


def encrypt(data, pw):
    salt, iv = os.urandom(16), os.urandom(12)
    raw = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ct = AESGCM(_key(pw, salt)).encrypt(iv, raw, None)
    b64 = lambda b: base64.b64encode(b).decode("ascii")
    return {"enc": "aes-gcm", "iter": ITERATIONS, "salt": b64(salt), "iv": b64(iv), "data": b64(ct)}


def decrypt(obj, pw):
    if pw is None:
        raise ValueError("暗号化されたデータですが BOATRACE_PASSWORD が設定されていません")
    d = lambda s: base64.b64decode(s)
    raw = AESGCM(_key(pw, d(obj["salt"]))).decrypt(d(obj["iv"]), d(obj["data"]), None)
    return json.loads(raw)
