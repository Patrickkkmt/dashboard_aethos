from flask import Flask, render_template, request, jsonify
import json
import os

app = Flask(__name__)

# 1. ROTA DA PÁGINA INICIAL (Apenas uma)
@app.route("/")
def dashboard():
    # Se o n8n já tiver enviado dados, lê o arquivo local. Se não, usa os dados padrão.
    if os.path.exists('dados.json'):
        with open('dados.json', 'r', encoding='utf-8') as f:
            dados_dashboard = json.load(f)
    else:
        # Dados padrão idênticos aos que o Claude gerou para o seu layout não abrir vazio
        dados_dashboard = {
            "funnel": {
                "labels": ["Leads", "Em contato", "Perdidos", "Perdidos sob controle", "Reuniões agendadas", "No-show"],
                "data": [102, 8, 50, 11, 26, 3]
            },
            "vendedores": {
                "labels": ["Luan", "Luiz", "Fernando", "Karine"],
                "data": [5, 6, 10, 5]
            },
            "perdas_split": {
                "labels": ["Nossa solução não atende", "Não tem potencial financeiro", "Número inválido", "Desqualificado", "Lead Frio"],
                "facebook_data": [8, 2, 7, 10, 4],
                "organico_data": [2, 9, 3, 7, 3]
            },
            "origens": {
                "labels": ["Facebook Ads", "Orgânico"],
                "data": [64, 38]
            },
            "qualidade_split": {
                "labels": ["1 Estrela", "2 Estrelas", "3 Estrelas", "4 Estrelas", "5 Estrelas"],
                "facebook_data": [22, 0, 22, 10, 10],
                "organico_data": [20, 2, 12, 0, 4]
            }
        }
    
    # Passa a variável 'dados_dashboard' com o nome 'dados' para o HTML
    return render_template("index.html", dados=dados_dashboard)

@app.route('/visao-anual')
def visao_anual():
    # Aqui renderizamos o novo arquivo HTML que vai conter os gráficos anuais
    return render_template('visao_anual.html')
# 2. ROTA DE RECEBIMENTO DO N8N
@app.route('/atualizar-dados', methods=['POST'])
def atualizar_dados():
    try:
        dados_recebidos = request.get_json()
        if not dados_recebidos:
            return jsonify({"erro": "Nenhum dado enviado"}), 400
            
        with open('dados.json', 'w', encoding='utf-8') as f:
            json.dump(dados_recebidos, f, ensure_ascii=False, indent=4)
            
        return jsonify({"status": "sucesso", "mensagem": "Dados gravados!"}), 200
    except Exception as e:
        return jsonify({"erro": str(e)}), 500


if __name__ == "__main__":
    app.run(debug=True)
