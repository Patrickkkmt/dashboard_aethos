"""
Dashboard SDR · Aethos Sistemas
--------------------------------
Páginas:
    /               -> dashboard do mês atual
    /visao-anual    -> consolidado do ano

Webhooks (o n8n envia os dados para cá):
    POST /atualizar-dados          -> grava dados.json            (números do mês)
    POST /webhook/visao-anual      -> grava dados_anuais.json     (números do ano)
    POST /webhook/analise-mensal   -> grava analise_mensal.json   (texto da IA no mensal)
    POST /webhook/analise-anual    -> grava analise_anual.json    (texto da IA no anual)

Segurança opcional: se a variável de ambiente WEBHOOK_TOKEN existir no Render,
os webhooks passam a exigir o header  X-Webhook-Token: <mesmo valor>.
Sem a variável, tudo funciona como antes.
"""
import hmac
import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, render_template, request

BASE_DIR = Path(__file__).resolve().parent
ARQUIVO_MENSAL = BASE_DIR / "dados.json"
ARQUIVO_ANUAL = BASE_DIR / "dados_anuais.json"
ARQUIVO_ANALISE_MENSAL = BASE_DIR / "analise_mensal.json"
ARQUIVO_ANALISE_ANUAL = BASE_DIR / "analise_anual.json"
FUSO_BRASILIA = timezone(timedelta(hours=-3))
WEBHOOK_TOKEN = os.environ.get("WEBHOOK_TOKEN", "").strip()

app = Flask(__name__)

# Ícone da Aethos usado no cabeçalho e na aba do navegador.
# Para usar outro arquivo, coloque a imagem em static/img/ e troque por "/static/img/logo.png".
LOGO_URL = "https://aethossistemas.com.br/wp-content/uploads/2025/09/cropped-0bxgwtveq56-270x270.png"


@app.context_processor
def variaveis_globais():
    return {"logo_url": LOGO_URL}


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


def normalizar_analise(pacote):
    """
    Aceita o que o n8n mandar e devolve sempre o mesmo formato:
      {"resumo": str, "destaques": [...], "alertas": [...], "recomendacoes": [...], "gerado_em": str}

    Formatos aceitos:
      1. O objeto pronto: {"resumo": "...", "destaques": [...], ...}
      2. A saída crua do Basic LLM Chain: {"text": "<JSON, com ou sem ```json```>"}
      3. Texto livre em "text": vira o resumo.
    """
    if not isinstance(pacote, dict):
        return None

    texto = pacote.get("text") or pacote.get("output")
    if isinstance(texto, str) and "resumo" not in pacote:
        limpo = re.sub(r"^```(?:json)?|```$", "", texto.strip(), flags=re.IGNORECASE).strip()
        try:
            pacote = json.loads(limpo)
        except json.JSONDecodeError:
            pacote = {"resumo": limpo}
        if not isinstance(pacote, dict):
            return None

    def lista(chave):
        valor = pacote.get(chave) or []
        if isinstance(valor, str):
            valor = [valor]
        return [str(item).strip() for item in valor if str(item).strip()][:6]

    analise = {
        "resumo": str(pacote.get("resumo") or "").strip(),
        "destaques": lista("destaques"),
        "alertas": lista("alertas"),
        "recomendacoes": lista("recomendacoes"),
        "gerado_em": datetime.now(FUSO_BRASILIA).strftime("%d/%m/%Y às %H:%M"),
    }
    if not any([analise["resumo"], analise["destaques"], analise["alertas"], analise["recomendacoes"]]):
        return None
    return analise


def receber_analise(caminho: Path):
    if not token_valido():
        return jsonify({"erro": "Token inválido ou ausente (header X-Webhook-Token)"}), 401

    analise = normalizar_analise(request.get_json(force=True, silent=True))
    if not analise:
        return jsonify({"erro": "Análise vazia ou em formato não reconhecido"}), 400

    try:
        salvar_json(caminho, analise)
    except Exception as e:
        return jsonify({"erro_interno": str(e)}), 500

    return jsonify({"status": "sucesso", "mensagem": "Análise gravada!", "analise": analise}), 200


# =========================================================
# PÁGINAS
# =========================================================
@app.route("/")
def dashboard():
    dados = ler_json(ARQUIVO_MENSAL, FALLBACK_MENSAL)
    analise = ler_json(ARQUIVO_ANALISE_MENSAL, None)
    return render_template("index.html", dados=dados, analise=analise, pagina="mensal")


@app.route("/visao-anual")
def visao_anual():
    dados = ler_json(ARQUIVO_ANUAL, FALLBACK_ANUAL)
    analise = ler_json(ARQUIVO_ANALISE_ANUAL, None)
    return render_template("visao_anual.html", dados_anuais=dados, analise=analise, pagina="anual")


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


@app.route("/webhook/analise-mensal", methods=["POST"])
def webhook_analise_mensal():
    return receber_analise(ARQUIVO_ANALISE_MENSAL)


@app.route("/webhook/analise-anual", methods=["POST"])
def webhook_analise_anual():
    return receber_analise(ARQUIVO_ANALISE_ANUAL)


if __name__ == "__main__":
    # Para rodar localmente: python app.py  ->  http://127.0.0.1:5000
    app.run(debug=True)
