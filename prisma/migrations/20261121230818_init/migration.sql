-- CreateTable
CREATE TABLE "ConfiguracaoFinanceira" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "valor_hora" REAL NOT NULL DEFAULT 25.0,
    "margem_padrao" REAL NOT NULL DEFAULT 40.0
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "endereco" TEXT,
    "telefone" TEXT
);

-- CreateTable
CREATE TABLE "Insumo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "qtd_total" REAL NOT NULL,
    "qtd_disponivel" REAL NOT NULL DEFAULT 0,
    "custo_total" REAL NOT NULL,
    "preco_unitario" REAL
);

-- CreateTable
CREATE TABLE "Flor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "tempo_confeccao_min" INTEGER NOT NULL DEFAULT 0,
    "custo_mao_de_obra" REAL NOT NULL DEFAULT 0.0,
    "custo_materiais" REAL NOT NULL DEFAULT 0.0,
    "custo_total" REAL NOT NULL DEFAULT 0.0
);

-- CreateTable
CREATE TABLE "FlorInsumo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "flor_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "quantidade" REAL NOT NULL,
    CONSTRAINT "FlorInsumo_flor_id_fkey" FOREIGN KEY ("flor_id") REFERENCES "Flor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlorInsumo_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "Insumo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" REAL NOT NULL DEFAULT 0.0,
    "preco_manual" BOOLEAN NOT NULL DEFAULT false,
    "custo_producao" REAL NOT NULL DEFAULT 0.0,
    "margem_lucro" REAL NOT NULL DEFAULT 0.0,
    "tempo_montagem_min" INTEGER NOT NULL DEFAULT 0,
    "imagem" TEXT,
    "tamanho" TEXT,
    "cor_principal" TEXT,
    "tipo" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "ProdutoFlor" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "produto_id" INTEGER NOT NULL,
    "flor_id" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    CONSTRAINT "ProdutoFlor_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "Produto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProdutoFlor_flor_id_fkey" FOREIGN KEY ("flor_id") REFERENCES "Flor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProdutoInsumo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "produto_id" INTEGER NOT NULL,
    "insumo_id" INTEGER NOT NULL,
    "quantidade" REAL NOT NULL,
    CONSTRAINT "ProdutoInsumo_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "Produto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProdutoInsumo_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "Insumo" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pedido" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "id_cliente" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Em Análise',
    "total" REAL NOT NULL,
    "custo_total" REAL NOT NULL DEFAULT 0.0,
    "lucro_estimado" REAL NOT NULL DEFAULT 0.0,
    "data" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pedido_id_cliente_fkey" FOREIGN KEY ("id_cliente") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "pedido_id" INTEGER NOT NULL,
    "produto_id" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "preco_unitario" REAL NOT NULL,
    "custo_unitario" REAL NOT NULL DEFAULT 0.0,
    CONSTRAINT "PedidoItem_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "Pedido" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PedidoItem_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Custo" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "descricao" TEXT NOT NULL,
    "categoria" TEXT NOT NULL DEFAULT 'Operacional',
    "valor" REAL NOT NULL,
    "data" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");
