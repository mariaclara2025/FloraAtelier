const express = require('express');
const session = require('express-session');
const { PrismaClient } = require('@prisma/client');
const path = require('path');

const {
    salvarBuquePrecificado,
    salvarInsumoERecalcular,
    salvarFlorComReceita,
    obterConfiguracao,
    atualizarConfiguracaoERecalcular,
    gerarResumoFinanceiro,
    formatarMoedaBR
} = require('./services/financeiro');
const {
    criarPedidoComBaixaEstoque,
    atualizarStatusPedido
} = require('./services/pedidos');
const {
    gerarRelatorioFinanceiroPdf
} = require('./services/relatorioPdf');

const prisma = new PrismaClient();
const app = express();
const port = process.env.PORT || 3000;

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, '../views'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
    secret: 'flora-atelier-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Disponibiliza helpers úteis nas views .html (EJS)
app.locals.formatarMoedaBR = formatarMoedaBR;

// Helper para normalizar linhas dinâmicas de formulário (1 item vira array)
function normalizarListaItens(ids, quantidades, chaveId) {
    const arrIds = Array.isArray(ids) ? ids : (ids !== undefined ? [ids] : []);
    const arrQtds = Array.isArray(quantidades) ? quantidades : (quantidades !== undefined ? [quantidades] : []);
    const resultado = [];

    for (let i = 0; i < arrIds.length; i++) {
        if (arrIds[i] && arrQtds[i]) {
            resultado.push({
                [chaveId]: Number(arrIds[i]),
                quantidade: Number(arrQtds[i])
            });
        }
    }
    return resultado;
}

// Middlewares de Autenticação e Permissão
function verificarLogado(req, res, next) {
    if (req.session && req.session.usuarioId) {
        return next();
    }
    return res.redirect('/login');
}

function verificarAdmin(req, res, next) {
    if (req.session && (req.session.tipo === 'Administrador' || req.session.tipo === 'Admin')) {
        return next();
    }
    return res.status(403).send('Acesso negado. Área restrita a administradores.');
}

// =======================================================
// ROTAS PÚBLICAS E AUTENTICAÇÃO
// =======================================================
app.get('/', (req, res) => {
    res.render('principal', { mensagem: null });
});

app.get('/login', (req, res) => {
    res.render('login', { mensagem: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const usuario = await prisma.usuario.findUnique({ where: { email } });
        if (usuario && usuario.senha === password) {
            req.session.usuarioId = usuario.id;
            req.session.nomeUsuario = usuario.nome;
            req.session.tipo = usuario.tipo;

            if (usuario.tipo === 'Administrador' || usuario.tipo === 'Admin') {
                return res.redirect('/dashboard');
            }
            return res.redirect('/catalogo');
        }
        return res.render('login', { mensagem: 'E-mail ou palavra-passe incorretos.' });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro interno ao processar o login.');
    }
});

app.get('/cadastro', (req, res) => {
    res.render('cadastro', { mensagem: null });
});

app.post('/cadastro', async (req, res) => {
    const { nome, email, password } = req.body;
    try {
        const usuarioExistente = await prisma.usuario.findUnique({ where: { email } });
        if (usuarioExistente) {
            return res.render('cadastro', { mensagem: 'Este e-mail já está cadastrado.' });
        }

        const novoUsuario = await prisma.usuario.create({
            data: {
                nome,
                email,
                senha: password,
                tipo: 'Cliente'
            }
        });

        req.session.usuarioId = novoUsuario.id;
        req.session.nomeUsuario = novoUsuario.nome;
        req.session.tipo = novoUsuario.tipo;

        return res.redirect('/catalogo');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao criar conta de usuário.');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// =======================================================
// VITRINE E CATÁLOGO DE PRODUTOS (Cliente)
// =======================================================
app.get('/catalogo', verificarLogado, async (req, res) => {
    const { pesquisa, categoria, preco_max } = req.query;
    try {
        const filtros = {OR: [
                { imagem: { not: null } },
                { descricao: { not: null } }
            ]};
        if (pesquisa) {
            filtros.nome = { contains: pesquisa };
        }
        if (categoria) {
            filtros.tipo = categoria;
        }
        if (preco_max) {
            filtros.preco = { lte: parseFloat(preco_max) };
        }
            // Dentro da sua rota GET '/catalogo' (ou '/')
const feedbacksAprovados = await prisma.pedido.findMany({
    where: {
        feedbackPublicado: true,
        feedback: { not: null }
    },
    include: {
        cliente: true // Ajuste se o relacionamento com usuário se chamar 'usuario' no seu schema
    },
    orderBy: { id: 'desc' },
    take: 10
});

        const produtos = await prisma.produto.findMany({ where: filtros });
        return res.render('catalogo', { produtos, nome_usuario: req.session.nomeUsuario, produtos, feedbacksAprovados });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar o catálogo.');
    }
});

app.get('/produto/:id', verificarLogado, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        const produto = await prisma.produto.findUnique({ where: { id } });
        if (!produto) return res.status(404).send('Produto não encontrado.');
        return res.render('detalhe', { produto });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar detalhes do produto.');
    }
});

// =======================================================
// CARRINHO DE COMPRAS E PEDIDOS
// =======================================================
app.get('/status/:id', async (req, res) => {

const pedidoId = Number(req.params.id);

    const pedido = await prisma.pedido.findUnique({
        where: { id: pedidoId }
    });

    if (!pedido) {
        return res.status(404).send("Pedido não encontrado");
    }

    res.render('status', { pedidoId, pedido });
});
// para continuamente informar o status do pedido
app.get('/api/status/:id', async (req, res) => {
    const pedido = await prisma.pedido.findUnique({
        where: { id: Number(req.params.id) },
        select: { status: true }
    });
    if (!pedido) return res.status(404).json({ erro: 'Não encontrado' });
    res.json({ status: pedido.status });
});
app.get('/carrinho', verificarLogado, (req, res) => {
    const carrinho = req.session.carrinho || [];
    const total_carrinho = carrinho.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
    res.render('carrinho', { itens_carrinho: carrinho, total_carrinho });
});

app.post('/adicionar_carrinho', verificarLogado, async (req, res) => {
    const { produto_id } = req.body;
    try {
        const produto = await prisma.produto.findUnique({ where: { id: parseInt(produto_id, 10) } });
        if (produto) {
            if (!req.session.carrinho) req.session.carrinho = [];
            const item = req.session.carrinho.find(i => i.id === produto.id);
            if (item) {
                item.quantidade += 1;
            } else {
                req.session.carrinho.push({
                    id: produto.id,
                    nome: produto.nome,
                    preco: produto.preco,
                    quantidade: 1
                });
            }
        }
        return res.redirect('/carrinho');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao adicionar item ao carrinho.');
    }
});

app.post('/remover_carrinho/:id', verificarLogado, (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (req.session.carrinho) {
        req.session.carrinho = req.session.carrinho.filter(i => i.id !== id);
    }
    res.redirect('/carrinho');
});

app.post('/limpar_carrinho', verificarLogado, (req, res) => {
    req.session.carrinho = [];
    res.redirect('/carrinho');
});

app.get('/info_compra', verificarLogado, (req, res) => {
    res.render('info_compra');
});

app.post('/info_compra', verificarLogado, async (req, res) => {
    const { endereco, telefone, forma_pagamento } = req.body;
    try {
        const usuarioAtualizado = await prisma.usuario.update({
            where: { id: req.session.usuarioId },
            data: { endereco, telefone }
        });
        
        req.session.usuario = usuarioAtualizado;
        req.session.forma_pagamento = forma_pagamento || 'Não informado';
        return res.redirect('/finalizar_compra');
    } catch (error) {
        console.error(error);
        return res.redirect('/carrinho');
    }
});

// Cria o pedido com snapshot de custo/preço + baixa automática de insumos
app.get('/finalizar_compra', verificarLogado, async (req, res) => {
    const carrinho = req.session.carrinho || [];
    if (carrinho.length === 0) {
        if (req.session.ultimoPedidoId) {
            const ultimoId = req.session.ultimoPedidoId;
            const ultimoLink = req.session.ultimoLinkWpp || '';
            return res.render('confirmacao', { linkWpp: ultimoLink, pedidoId: ultimoId });
        }
        cosole.log(ultimoId)
        return res.redirect('/catalogo');
    }

    try {
        const itensPedido = carrinho.map(item => ({
            produtoId: item.id,
            quantidade: item.quantidade
        }));

        const { pedido, alertasEstoqueBaixo } = await criarPedidoComBaixaEstoque({
            idCliente: req.session.usuarioId,
            itens: itensPedido,
            status: 'Em Análise',
            bloquearSemEstoque: false
        });

        const usuarioInfo = req.session.usuario || await prisma.usuario.findUnique({
            where: { id: req.session.usuarioId }
        });

        const listaItens = pedido.itens
            .map(item => `• ${item.quantidade}x ${item.produto.nome} (R$ ${(item.precoUnitario * item.quantidade).toFixed(2)})`)
            .join('\n');

        const formaPag = req.session.forma_pagamento || 'Não informado';
        const mensagemWpp =
            `Olá! Gostaria de finalizar meu pedido #${pedido.id}:\n\n` +
            `*Itens:*\n${listaItens}\n\n` +
            `*Total:* R$ ${Number(pedido.total).toFixed(2)}\n` +
            `*Pagamento:* ${formaPag}\n` +
            `*Endereço:* ${usuarioInfo?.endereco || 'Não informado'}\n` +
            `*Contato:* ${usuarioInfo?.telefone || 'Não informado'}`;

        const numeroWpp = '5583982060613';
        const linkWpp = `https://wa.me/${numeroWpp}?text=${encodeURIComponent(mensagemWpp)}`;

        req.session.carrinho = [];
        req.session.ultimoPedidoId = pedido.id;
        req.session.ultimoLinkWpp = linkWpp;

        return res.render('confirmacao', {
            linkWpp,
            pedidoId: pedido.id,
            alertasEstoqueBaixo
        });
    } catch (error) {
        console.error('Erro ao finalizar pedido:', error);
        return res.status(500).send(error.message || 'Erro ao finalizar o pedido.');
    }
});

app.get('/meus_pedidos', verificarLogado, async (req, res) => {
    try {
        const pedidos = await prisma.pedido.findMany({
            where: { idCliente: req.session.usuarioId },
            include: { itens: { include: { produto: true } } },
            orderBy: { id: 'desc' }
        });
        return res.render('meus_pedidos', { pedidos, nome_usuario: req.session.nomeUsuario });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao buscar seus pedidos.');
    }
});
// Rota para o CLIENTE concluir o pedido e salvar o feedback
app.post('/pedidos/:id/concluir', verificarLogado, async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const { feedback } = req.body;

        const pedido = await prisma.pedido.findFirst({
            where: {
                id: pedidoId,
                idCliente: req.session.usuarioId
            }
        });

        if (!pedido) {
            return res.status(403).send('Pedido não encontrado ou sem permissão.');
        }

        await prisma.pedido.update({
            where: { id: pedidoId },
            data: {
                status: 'Concluído',
                feedback: feedback && feedback.trim() !== '' ? feedback.trim() : null
            }
        });

        return res.redirect('/meus_pedidos');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao concluir o pedido.');
    }
});
// =======================================================
// PAINEL ADMINISTRATIVO, ENGENHARIA, FINANÇAS E PDF
// =======================================================
app.post('/admin/pedidos/:id/publicar-feedback', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });

        if (!pedido) return res.status(404).send('Pedido não encontrado.');

        await prisma.pedido.update({
            where: { id: pedidoId },
            data: { feedbackPublicado: !pedido.feedbackPublicado }
        });

        return res.redirect('/pedidos'); 
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao moderar feedback.');
    }
});
app.get('/dashboard', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const [produtos, pedidos, resumoMensal] = await Promise.all([
            prisma.produto.findMany(),
            prisma.pedido.findMany({
                include: { cliente: true },
                orderBy: { id: 'desc' }
            }),
            gerarResumoFinanceiro({ tipo: 'mensal' })
        ]);

        return res.render('dashboard', {
            produtos,
            pedidos,
            faturamento: resumoMensal.faturamentoBruto,
            custo_producao: resumoMensal.custoProducaoPedidos,
            total_custos: resumoMensal.outrasDespesas,
            lucro: resumoMensal.lucroLiquido,
            margem_liquida: resumoMensal.margemLiquidaPct,
            resumoMensal,
            nome_usuario: req.session.nomeUsuario
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar o dashboard administrativo.');
    }
});
// 1. Página exclusiva para o Admin avaliar os feedbacks recebidos
app.get('/admin/feedbacks', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const pedidosComFeedback = await prisma.pedido.findMany({
            where: {
                feedback: { not: null }
            },
            include: {
                cliente: true // Se no seu schema a relação se chamar 'usuario', troque para 'usuario: true'
            },
            orderBy: { id: 'desc' }
        });

        res.render('avaliar_feedbacks', { pedidos: pedidosComFeedback });
    } catch (error) {
        console.error(error);
        res.status(500).send('Erro ao carregar feedbacks.');
    }
});

// 2. Botão de Aprovar / Ocultar no carrossel
app.post('/admin/feedbacks/:id/alternar', verificarLogado, verificarAdmin,async (req, res) => {
    try {
        const pedidoId = Number(req.params.id);
        const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });

        if (!pedido) return res.status(404).send('Pedido não encontrado.');

        await prisma.pedido.update({
            where: { id: pedidoId },
            data: { feedbackPublicado: !pedido.feedbackPublicado }
        });

        return res.redirect('/admin/feedbacks');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao atualizar status do feedback.');
    }
});
// Insumos / Materiais -> views/planilha_insumos.html
app.get('/insumos', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const insumos = await prisma.insumo.findMany({ orderBy: { id: 'desc' } });
        return res.render('planilha_insumos', {
            insumos,
            nome_usuario: req.session.nomeUsuario,
            mensagem: req.query.ok ? 'Insumo salvo e custos recalculados!' : null
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar insumos.');
    }
});

app.post('/insumos', verificarLogado, verificarAdmin, async (req, res) => {
    const { id, nome, qtd_total, qtd_disponivel, custo_total } = req.body;
    try {
        await salvarInsumoERecalcular({
            id: id || undefined,
            nome,
            qtdTotal: qtd_total,
            qtdDisponivel: qtd_disponivel !== '' ? qtd_disponivel : undefined,
            custoTotal: custo_total
        });
        return res.redirect('/insumos?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send(error.message || 'Erro ao salvar insumo.');
    }
});

app.post('/insumos/excluir/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        await prisma.insumo.delete({ where: { id } });
        return res.redirect('/insumos?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send('Não foi possível excluir o insumo (ele pode estar em uso em alguma flor ou buquê).');
    }
});

// Flores -> views/planilha_flores.html
app.get('/flores', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const [flores, insumos, config] = await Promise.all([
            prisma.flor.findMany({
                include: { insumos: { include: { insumo: true } } },
                orderBy: { id: 'desc' }
            }),
            prisma.insumo.findMany({ orderBy: { nome: 'asc' } }),
            obterConfiguracao()
        ]);

        return res.render('planilha_flores', {
            flores,
            insumos,
            config,
            nome_usuario: req.session.nomeUsuario,
            mensagem: req.query.ok ? 'Flor salva e custo calculado automaticamente!' : null
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar flores.');
    }
});

app.post('/flores', verificarLogado, verificarAdmin, async (req, res) => {
    const { id, nome, tempo_confeccao_min, insumo_id, quantidade_insumo } = req.body;
    try {
        const itensInsumos = normalizarListaItens(insumo_id, quantidade_insumo, 'insumoId');
        await salvarFlorComReceita({
            id: id || undefined,
            nome,
            tempoConfeccaoMin: tempo_confeccao_min,
            itensInsumos
        });
        return res.redirect('/flores?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send(error.message || 'Erro ao salvar flor.');
    }
});

app.post('/flores/excluir/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        await prisma.flor.delete({ where: { id } });
        return res.redirect('/flores?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send('Não foi possível excluir a flor (ela pode estar em uso em algum buquê).');
    }
});

// Buquês e Precificação -> views/precificacao.html
app.get('/precificacao', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const [produtos, flores, insumos, config] = await Promise.all([
            prisma.produto.findMany({
                include: {
                    flores: { include: { flor: true } },
                    insumos: { include: { insumo: true } }
                },
                orderBy: { id: 'desc' }
            }),
            prisma.flor.findMany({ orderBy: { nome: 'asc' } }),
            prisma.insumo.findMany({ orderBy: { nome: 'asc' } }),
            obterConfiguracao()
        ]);

        return res.render('precificacao', {
            produtos,
            flores,
            insumos,
            config,
            nome_usuario: req.session.nomeUsuario,
            mensagem: req.query.ok ? 'Precificação atualizada com sucesso!' : null
        });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar tela de precificação.');
    }
});

app.post('/configuracao-financeira', verificarLogado, verificarAdmin, async (req, res) => {
    const { valor_hora, margem_padrao } = req.body;
    try {
        await atualizarConfiguracaoERecalcular({
            valorHora: valor_hora,
            margemPadrao: margem_padrao
        });
        return res.redirect('/precificacao?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send('Erro ao atualizar configuração financeira.');
    }
});

app.post('/precificacao/buque', verificarLogado, verificarAdmin, async (req, res) => {
    const {
        id,
        nome,
        descricao,
        tipo,
        imagem,
        tamanho,
        cor_principal,
        tempo_montagem_min,
        margem_lucro,
        preco_manual,
        preco_informado,
        flor_id,
        quantidade_flor,
        insumo_extra_id,
        quantidade_insumo_extra
    } = req.body;

    try {
        const itensFlores = normalizarListaItens(flor_id, quantidade_flor, 'florId');
        const itensInsumos = normalizarListaItens(insumo_extra_id, quantidade_insumo_extra, 'insumoId');
        const usarManual = preco_manual === 'true' || preco_manual === 'on' || preco_manual === true;

        await salvarBuquePrecificado({
            id: id || undefined,
            nome,
            descricao,
            tipo: tipo || 'Buquê Completo',
            imagem: imagem || '',
            tamanho: tamanho || 'Médio',
            corPrincipal: cor_principal || 'Variado',
            tempoMontagemMin: tempo_montagem_min,
            margemLucro: margem_lucro,
            precoManual: usarManual,
            precoInformado: preco_informado,
            itensFlores,
            itensInsumos
        });

        return res.redirect('/precificacao?ok=1');
    } catch (error) {
        console.error(error);
        return res.status(400).send(error.message || 'Erro ao salvar buquê e precificação.');
    }
});

// Relatório PDF semanal ou mensal
app.get('/relatorio.pdf', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const { tipo = 'semanal', ano, mes, dataInicio, dataFim } = req.query;
        const { buffer, nomeArquivo } = await gerarRelatorioFinanceiroPdf({
            tipo,
            ano,
            mes,
            dataInicio,
            dataFim
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);
        return res.send(buffer);
    } catch (error) {
        console.error('Erro ao gerar PDF:', error);
        return res.status(500).send('Erro ao gerar o relatório financeiro em PDF.');
    }
});

app.get('/novo_produto', verificarLogado, verificarAdmin, async(req, res) => {
    const produtos = await prisma.produto.findMany({
        orderBy: { nome: 'asc' }
    });
    res.render('novo_produto.html', { produtos });
});

app.post('/novo_produto', verificarLogado, verificarAdmin, async (req, res) => {
    const {id,
        nome,
        descricao,
        preco,
        imagem,
        tipo,
        tamanho,
        cor_principal,
        tempo_montagem_min,
        margem_lucro,
        preco_manual // manual
    } = req.body;

    const usarPrecoManual = preco_manual === 'true' || preco_manual === 'on' || preco_manual === true;

    try {
        if (id) {
            await prisma.produto.update({
                where: { id: Number(id) },
                data: {
                    nome: String(nome).trim(),
                    descricao: descricao || 'Buquê artesanal em chenille.',
                    tipo: tipo || 'Buquê Completo',
                    tamanho: tamanho || 'Médio',
                    corPrincipal: cor_principal || 'Variado',
                    ...(imagem ? { imagem } : {})
                }
            });}
            else{ 
        await salvarBuquePrecificado({
            nome,
            descricao,
            tipo,
            imagem: imagem || '',
            tamanho: tamanho || 'Padrão',
            corPrincipal: cor_principal || 'Variado',
            tempoMontagemMin: Number(tempo_montagem_min) || 0,
            margemLucro: margem_lucro !== undefined && margem_lucro !== '' ? Number(margem_lucro) : undefined,
            precoManual: usarPrecoManual,
            precoInformado: preco !== undefined && preco !== '' ? Number(preco) : undefined
        });
    }
        return res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao cadastrar novo produto.');
    }
});

app.get('/excluir_produto/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    try {
        await prisma.produto.delete({ where: { id } });
        return res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao excluir produto.');
    }
});

app.get('/pedidos', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const pedidosDb = await prisma.pedido.findMany({
            include: { cliente: true },
            orderBy: { id: 'desc' }
        });
        const pedidos = pedidosDb.map(p => ({
            id: p.id,
            data: p.data ? new Date(p.data).toLocaleDateString('pt-BR') : 'Recentemente',
            nome_cliente: p.cliente ? p.cliente.nome : 'Cliente',
            total: p.total,
            custoTotal: p.custoTotal,
            lucroEstimado: p.lucroEstimado,
            status: p.status
        }));
        return res.render('pedidos', { pedidos, nome_usuario: req.session.nomeUsuario });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar lista de pedidos.');
    }
});

app.post('/atualizar_pedido/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { status } = req.body;
    try {
        await atualizarStatusPedido(id, status);
        return res.redirect('/pedidos');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao atualizar status do pedido.');
    }
});

app.get('/custos', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const lista_custos = await prisma.custo.findMany({ orderBy: { id: 'desc' } });
        return res.render('custos', { lista_custos });
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao carregar custos.');
    }
});

app.post('/custos', verificarLogado, verificarAdmin, async (req, res) => {
    const { descricao, categoria, valor, data } = req.body;
    try {
        await prisma.custo.create({
            data: {
                descricao,
                categoria: categoria || 'Operacional',
                valor: parseFloat(valor) || 0,
                data: data ? new Date(data) : new Date()
            }
        });
        return res.redirect('/custos');
    } catch (error) {
        console.error(error);
        return res.status(500).send('Erro ao registrar custo.');
    }
});

app.listen(port, () => {
    console.log(`Flora Atelier rodando: http://localhost:${port}`);
});