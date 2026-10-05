"""
Dashboard SDR · Aethos Sistemas
--------------------------------
Páginas:
    /               -> dashboard do mês atual
    /visao-anual    -> consolidado do ano

Webhooks (o n8n envia os dados para cá):
    POST /atualizar-dados       -> grava dados.json
    POST /webhook/visao-anual   -> grava dados_anuais.json

Segurança opcional: se a variável de ambiente WEBHOOK_TOKEN existir no Render,
os webhooks passam a exigir o header  X-Webhook-Token: <mesmo valor>.
Sem a variável, tudo funciona como antes.
"""
import hmac
import json
import os
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
ARQUIVO_MENSAL = BASE_DIR / "dados.json"
ARQUIVO_ANUAL = BASE_DIR / "dados_anuais.json"
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "").strip()

app = Flask(__name__)


# =========================================================
# DADOS DE RESERVA (usados enquanto o n8n não enviou nada)
# =========================================================
FALLBACK_MENSAL = {
    "funnel": {
        "labels": ["Leads", "Em contato", "Perdidos", "Perdidos sob controle", "Reuniões agendadas", "No-show"],
        "data": [0, 0, 0, 0, 0, 0],
    },
    "vendedores": {"labels": ["Luan", "Luiz", "Fernando", "Karine"], "data": [0, 0, 0, 0]},
    "perdas_split": {"labels": [], "facebook_data": [], "organico_data": []},
    "origens": {"labels": ["Facebook Ads", "Orgânico"], "data": [0, 0]},
    "qualidade_split": {
        "labels": ["1 Estrela", "2 Estrelas", "3 Estrelas", "4 Estrelas", "5 Estrelas"],
        "facebook_data": [0, 0, 0, 0, 0],
        "organico_data": [0, 0, 0, 0, 0],
    },
}

FALLBACK_ANUAL = {
    "labels_meses": ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"],
    "total_leads": {"facebook": [], "organico": [], "total": []},
    "qualidade_fb": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
    "qualidade_org": {"1_estrela": [], "2_estrelas": [], "3_estrelas": [], "4_estrelas": [], "5_estrelas": []},
    "perdas_fb": [],
    "perdas_org": [],
    "vendedores": {"Luan": [], "Luiz": [], "Fernando": [], "Karine": []},
}


# =========================================================
# FUNÇÕES AUXILIARES
# =========================================================
def ler_json(caminho: Path, padrao: dict) -> dict:
    """Lê um arquivo JSON; se não existir ou estiver corrompido, devolve o padrão."""
    try:
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return padrao


def salvar_json(caminho: Path, dados: dict) -> None:
    """Grava em um arquivo temporário e troca no final: a página nunca lê um arquivo pela metade."""
    temporario = caminho.with_suffix(".tmp")
    with open(temporario, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, indent=4)
    os.replace(temporario, caminho)


def token_valido() -> bool:
    if not WEBHOOK_TOKEN:
        return True
    enviado = request.headers.get("X-Webhook-Token", "")
    return hmac.compare_digest(enviado, WEBHOOK_TOKEN)


def receber_webhook(caminho: Path, mensagem_ok: str):
    if not token_valido():
        return jsonify({"erro": "Token inválido ou ausente (header X-Webhook-Token)"}), 401

    # force=True: aceita o pacote mesmo se o n8n não mandar o Content-Type certo
    # silent=True: JSON inválido vira None em vez de estourar uma página de erro HTML
    dados = request.get_json(force=True, silent=True)
    if not dados:
        return jsonify({"erro": "Nenhum dado enviado ou JSON inválido"}), 400

    try:
        salvar_json(caminho, dados)
    except Exception as e:  # devolve o erro exato para o n8n
        return jsonify({"erro_interno": str(e)}), 500

    return jsonify({"status": "sucesso", "mensagem": mensagem_ok}), 200


# =========================================================
# PÁGINAS
# =========================================================
@app.route("/")
def dashboard():
    dados = ler_json(ARQUIVO_MENSAL, FALLBACK_MENSAL)
    return render_template("index.html", dados=dados)


@app.route("/visao-anual")
def visao_anual():
    dados = ler_json(ARQUIVO_ANUAL, FALLBACK_ANUAL)
    return render_template("visao_anual.html", dados_anuais=dados)


@app.route("/health")
def health():
    """Rota leve para o 'ping' do n8n manter o Render acordado."""
    return jsonify({"status": "ok"}), 200


# =========================================================
# WEBHOOKS (o n8n injeta os dados aqui)
# =========================================================
@app.route("/atualizar-dados", methods=["POST"])
def atualizar_dados():
    return receber_webhook(ARQUIVO_MENSAL, "Dados gravados!")


@app.route("/webhook/visao-anual", methods=["POST"])
def webhook_visao_anual():
    return receber_webhook(ARQUIVO_ANUAL, "Dados anuais gravados!")


if __name__ == "__main__":
    # Para rodar localmente: python app.py  ->  http://127.0.0.1:5000
    app.run(debug=True)
