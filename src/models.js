class Usuario {
    constructor(id, nome, email, senha, tipo) {
        this.id = id;
        this.nome = nome;
        this.email = email;
        this.senha = senha;
        this.tipo = tipo;
    }
}

class Cliente extends Usuario {
    constructor(id, nome, email, senha, endereco, telefone) {
        super(id, nome, email, senha, 'Cliente');
        this.endereco = endereco;
        this.telefone = telefone;
    }
}

class Administrador extends Usuario {
    constructor(id, nome, email, senha, nivelAcesso = "Total") {
        super(id, nome, email, senha, 'Admin');
        this.nivelAcesso = nivelAcesso;
    }
}

class Produto {
    constructor(id, nome, descricao, preco, imagem, tipo) {
        this.id = id;
        this.nome = nome;
        this.descricao = descricao;
        this.preco = preco;
        this.imagem = imagem;
        this.tipo = tipo;
    }
}

class Buque extends Produto {
    constructor(id, nome, descricao, preco, imagem, tamanho, corPrincipal) {
        super(id, nome, descricao, preco, imagem, 'Buquê Completo');
        this.tamanho = tamanho;
        this.corPrincipal = corPrincipal;
    }
}

class Pedido {
    constructor(id, idCliente, status = "Em Análise", total = 0) {
        this.id = id;
        this.idCliente = idCliente;
        this.status = status;
        this.total = total;
        this.itens = [];
    }

    adicionarItem(item) {
        this.itens.push(item);
    }

    calcularTotal() {
        return this.itens.reduce((acc, item) => acc + (item.preco * item.quantidade), 0);
    }
}
class ItemCarrinho {
    constructor(produto, quantidade) {
        this.produto = produto;
        this.quantidade = quantidade;
    }

    calcularSubtotal() {
        return this.produto.preco * this.quantidade;
    }
}

module.exports = { 
    Usuario, 
    Cliente, 
    Administrador, 
    Produto, 
    Buque, 
    Pedido, 
    ItemCarrinho 
};

module.exports = { Usuario, Cliente, Administrador, Produto, Buque, Pedido };