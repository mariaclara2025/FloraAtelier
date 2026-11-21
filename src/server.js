const express = require('express');
const session = require('express-session');
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const { prototype } = require('stream');
const port = 3000
const prisma = new PrismaClient();
const app = express();


app.engine('html', require('ejs').renderFile);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, '../views'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use(session({
    secret: 'flora-atelier-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Defina como true se usar HTTPS no Codespace
}));

// Middlewares de Autenticação e Permissão
function verificarLogado(req, res, next) {
    if (req.session && req.session.usuarioId) {
        return next();
    }
    res.redirect('/login');
}

function verificarAdmin(req, res, next) {
    if (req.session && req.session.tipo === 'Administrador') {
        return next();
    }
    res.status(403).send('Acesso negado. Área restrita a administradores.');
}

// =======================================================
// ROTAS PÚBLICAS E AUTENTICAÇÃO
// =======================================================
app.get('/', (req, res) => {
    res.render('principal', { mensagem: null });
});

app.get('/login', (req, res) => {
    res.render('login');
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const usuario = await prisma.usuario.findUnique({ where: { email } });
        if (usuario && usuario.senha === password) {
            req.session.usuarioId = usuario.id;
            req.session.nomeUsuario = usuario.nome;
            req.session.tipo = usuario.tipo;
            console.log(req.session.usuarioId)
            if (usuario.tipo === 'Administrador') {
                return res.redirect('/dashboard');
            }
            return res.redirect('/catalogo');
        }
        res.render('login', { mensagem: 'E-mail ou palavra-passe incorretos.' });
    } catch (error) {
        res.status(500).send('Erro interno ao processar o login.');
    }
});

app.get('/cadastro', (req, res) => {
    res.render('cadastro');
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

        res.redirect('/catalogo');
    } catch (error) {
        res.status(500).send('Erro ao criar conta de usuário.');
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
        let filtros = {};
        if (pesquisa) {
            filtros.nome = { contains: pesquisa };
        }
        if (categoria) {
            filtros.tipo = categoria;
        }
        if (preco_max) {
            filtros.preco = { lte: parseFloat(preco_max) };
        }

        const produtos = await prisma.produto.findMany({ where: filtros });
        res.render('catalogo', { produtos, nome_usuario: req.session.nomeUsuario });
    } catch (error) {
        res.status(500).send('Erro ao carregar o catálogo.');
    }
});

app.get('/produto/:id', verificarLogado, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        const produto = await prisma.produto.findUnique({ where: { id } });
        if (!produto) return res.status(404).send('Produto não encontrado.');
        res.render('detalhe', { produto });
    } catch (error) {
        res.status(500).send('Erro ao carregar detalhes do produto.');
    }
});

// =======================================================
// CARRINHO DE COMPRAS E PEDIDOS
// =======================================================
app.get('/carrinho', verificarLogado, (req, res) => {
    const carrinho = req.session.carrinho || [];
    const total_carrinho = carrinho.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
    res.render('carrinho', { itens_carrinho: carrinho, total_carrinho });
});

app.post('/adicionar_carrinho', verificarLogado, async (req, res) => {
    const { produto_id } = req.body;
    try {
        const produto = await prisma.produto.findUnique({ where: { id: parseInt(produto_id) } });
        if (produto) {
            if (!req.session.carrinho) req.session.carrinho = [];
            let item = req.session.carrinho.find(i => i.id === produto.id);
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
        res.redirect('/carrinho');
    } catch (error) {
        res.status(500).send('Erro ao adicionar item ao carrinho.');
    }
});

app.post('/remover_carrinho/:id', verificarLogado, (req, res) => {
    const id = parseInt(req.params.id);
    if (req.session.carrinho) {
        req.session.carrinho = req.session.carrinho.filter(i => i.id !== id);
    }
    res.redirect('/carrinho');
});

app.post('/limpar_carrinho', verificarLogado, (req, res) => {
    req.session.carrinho = [];
    res.redirect('/carrinho');
});
app.get('/info_compra',verificarLogado, (req,res) =>{
    console.log("Aplicou rota info_compra do metodo get")
    res.render("info_compra")
})
app.post('/info_compra', verificarLogado, async (req, res) => {
    const { endereco, telefone, forma_pagamento } = req.body;

    try {
        console.log("entrou rota info_compra do metodo post")
        console.log(req.session.usuarioId)
         console.log(req.session.usuarioId)
        console.log(endereco)
       const usuarioAtualizado = await prisma.usuario.update({
            where: { id: req.session.usuarioId },
            data: { endereco, telefone }
        });
        req.session.usuario = usuarioAtualizado
        console.log(req.session.usuario)
        req.session.forma_pagamento = forma_pagamento;
            console.log("Aplicou rota info_compra do metodo post")
        res.redirect('/finalizar_compra');
    } catch (error) {
        console.error(error);
        res.redirect('/carrinho');
    }
});

app.get('/finalizar_compra', verificarLogado, async (req, res) => {
    const carrinho = req.session.carrinho || [];
    console.log("Aplicou rota finalizar_compra do metodo GET")

    if (carrinho.length === 0) return res.redirect('/catalogo');

    const total = carrinho.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
    try {
        const novoPedido = await prisma.pedido.create({
         data: {
        idCliente: req.session.usuario.id,
        total: total,
        status: 'Em Análise',
        formaPagamento: req.session.forma_pagamento || 'Não informado'
         }
        });
            const listaItens = carrinho
            .map(item => `• ${item.quantidade}x ${item.nome} (R$ ${(item.preco * item.quantidade).toFixed(2)})`)
            .join('\n');
          

       const mensagemWpp = `Olá! Gostaria de finalizar meu pedido #${novoPedido.id}:\n\n` +
            `*Itens:*\n${listaItens}\n\n` +
            `*Total:* R$ ${total.toFixed(2)}\n` +
            `*Pagamento:* ${req.session.forma_pagamento}\n` +
            `*Endereço:* ${req.session.usuario.endereco}\n` +
            `*Contato:* ${req.session.usuario.telefone}`;      
       const numeroWpp = '5583982060613'; 
const linkWpp = `https://wa.me/${numeroWpp}?text=${encodeURIComponent(mensagemWpp)}`;
        req.session.carrinho = [];
        res.render('confirmacao', { linkWpp, pedidoId: novoPedido.id });
    } catch (error) {
        res.status(500).send('Erro ao finalizar o pedido.');
    }
});

app.get('/meus_pedidos', verificarLogado, async (req, res) => {
    try {
        const pedidos = await prisma.pedido.findMany({
            where: { idCliente: req.session.usuarioId },
            orderBy: { id: 'desc' }
        });
        res.render('meus_pedidos', { pedidos, nome_usuario: req.session.nomeUsuario });
    } catch (error) {
        res.status(500).send('Erro ao buscar seus pedidos.');
    }
});

// =======================================================
// PAINEL ADMINISTRATIVO E ENGENHARIA (CRUD)
// =======================================================
app.get('/dashboard', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const produtos = await prisma.produto.findMany();
        const pedidos = await prisma.pedido.findMany({ include: { cliente: true } });
        const custos = await prisma.custo.findMany();

        const faturamento = pedidos.reduce((acc, p) => acc + p.total, 0);
        const total_custos = custos.reduce((acc, c) => acc + c.valor, 0);
        const lucro = faturamento - total_custos;

        res.render('dashboard', {
            produtos,
            pedidos,
            faturamento,
            total_custos,
            lucro,
            nome_usuario: req.session.nomeUsuario
        });
    } catch (error) {
        res.status(500).send('Erro ao carregar o dashboard administrativo.');
    }
});

app.get('/novo_produto', verificarLogado, verificarAdmin, (req, res) => {
    res.render('novo_produto');
});

app.post('/novo_produto', verificarLogado, verificarAdmin, async (req, res) => {
    const { nome, descricao, preco, imagem, tipo, tamanho, cor_principal } = req.body;
    try {
        console.log("Entrou no try")
        console.log(preco, typeof preco)
        await prisma.produto.create({
            data: {
                nome,
                descricao,
                preco: parseFloat(preco),
                imagem: imagem || '',
                tipo,
                tamanho: tamanho || 'Padrão',
                corPrincipal: cor_principal || 'Variado'
            }
        });
        console.log("Passou a ligação do banco")
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error)
        res.status(500).send('Erro ao cadastrar novo produto.');
    }
});

app.get('/excluir_produto/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    try {
        await prisma.produto.delete({ where: { id } });
        res.redirect('/dashboard');
    } catch (error) {
        res.status(500).send('Erro ao excluir produto.');
    }
});

app.get('/pedidos', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const pedidosDb = await prisma.pedido.findMany({ include: { cliente: true }, orderBy: { id: 'desc' } });
        const pedidos = pedidosDb.map(p => ({
            id: p.id,
            data: 'Recentemente',
            nome_cliente: p.cliente ? p.cliente.nome : 'Cliente',
            total: p.total,
            status: p.status
        }));
        res.render('pedidos', { pedidos, nome_usuario: req.session.nomeUsuario });
    } catch (error) {
        res.status(500).send('Erro ao carregar lista de pedidos.');
    }
});

app.post('/atualizar_pedido/:id', verificarLogado, verificarAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const { status } = req.body;
    try {
        await prisma.pedido.update({
            where: { id },
            data: { status }
        });
        res.redirect('/pedidos');
    } catch (error) {
        res.status(500).send('Erro ao atualizar status do pedido.');
    }
});

app.get('/custos', verificarLogado, verificarAdmin, async (req, res) => {
    try {
        const lista_custos = await prisma.custo.findMany({ orderBy: { id: 'desc' } });
        res.render('custos', { lista_custos });
    } catch (error) {
        res.status(500).send('Erro ao carregar custos.');
    }
});

app.post('/custos', verificarLogado, verificarAdmin, async (req, res) => {
    const { descricao, valor, data } = req.body;
    try {
        await prisma.custo.create({
            data: {
                descricao,
                valor: parseFloat(valor),
                data
            }
        });
        res.redirect('/custos');
    } catch (error) {
        res.status(500).send('Erro ao registrar custo.');
    }
});


app.listen(port, () => {
    console.log(`Flora Atelier rodando: http://localhost:${port}`);
});