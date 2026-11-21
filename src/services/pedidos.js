const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

function arredondar2(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula o consumo total de cada Insumo para um conjunto de itens de produto.
 * Retorna um Map<insumoId, quantidadeTotalGasta>.
 */
function calcularConsumoInsumosDosProdutos(produtos, mapaQuantidades) {
  const consumoPorInsumo = new Map();

  const somarConsumo = (insumoId, qtd) => {
    const idNum = Number(insumoId);
    const qtdNum = Number(qtd);
    if (!idNum || !Number.isFinite(qtdNum) || qtdNum <= 0) return;
    consumoPorInsumo.set(idNum, (consumoPorInsumo.get(idNum) || 0) + qtdNum);
  };

  for (const prod of produtos) {
    const qtdComprada = Number(mapaQuantidades.get(prod.id) || 0);
    if (qtdComprada <= 0) continue;

    // 1) Insumos diretos no produto (ex.: embrulho coreano, laço)
    for (const pi of prod.insumos || []) {
      somarConsumo(pi.insumoId, Number(pi.quantidade || 0) * qtdComprada);
    }

    // 2) Insumos das flores que compõem o produto
    for (const pf of prod.flores || []) {
      const qtdFlorNoProduto = Number(pf.quantidade || 0) * qtdComprada;
      for (const fi of pf.flor?.insumos || []) {
        somarConsumo(fi.insumoId, Number(fi.quantidade || 0) * qtdFlorNoProduto);
      }
    }
  }

  return consumoPorInsumo;
}

/**
 * Cria um pedido com snapshot de preço e custo e baixa automática no estoque de insumos.
 *
 * @param {Object} params
 * @param {number} params.idCliente
 * @param {Array<{ produtoId: number, quantidade: number }>} params.itens
 * @param {string} [params.status='Em Análise']
 * @param {boolean} [params.bloquearSemEstoque=false]
 * @param {number} [params.limiteAlertaEstoque=5]
 */
async function criarPedidoComBaixaEstoque({
  idCliente,
  itens,
  status = 'Em Análise',
  bloquearSemEstoque = false,
  limiteAlertaEstoque = 5
}) {
  if (!idCliente) {
    throw new Error('Cliente não informado para o pedido.');
  }
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new Error('O pedido precisa ter pelo menos um item.');
  }

  return prisma.$transaction(async (tx) => {
    const cliente = await tx.usuario.findUnique({ where: { id: Number(idCliente) } });
    if (!cliente) {
      throw new Error('Cliente não encontrado no sistema.');
    }

    // Agrupa quantidades caso o mesmo produto venha repetido
    const mapaQuantidades = new Map();
    for (const item of itens) {
      const produtoId = Number(item.produtoId);
      const quantidade = parseInt(item.quantidade, 10);
      if (produtoId > 0 && Number.isInteger(quantidade) && quantidade > 0) {
        mapaQuantidades.set(produtoId, (mapaQuantidades.get(produtoId) || 0) + quantidade);
      }
    }

    if (mapaQuantidades.size === 0) {
      throw new Error('Nenhum item válido foi informado no pedido.');
    }

    const produtoIds = [...mapaQuantidades.keys()];

    const produtos = await tx.produto.findMany({
      where: { id: { in: produtoIds } },
      include: {
        insumos: { include: { insumo: true } },
        flores: {
          include: {
            flor: {
              include: {
                insumos: { include: { insumo: true } }
              }
            }
          }
        }
      }
    });

    if (produtos.length !== produtoIds.length) {
      throw new Error('Um ou mais produtos selecionados não existem.');
    }

    let totalPedido = 0;
    let custoTotalPedido = 0;
    const itensParaCriar = [];

    for (const prod of produtos) {
      const qtdComprada = mapaQuantidades.get(prod.id);
      const precoUnit = arredondar2(prod.preco);
      const custoUnit = arredondar2(prod.custoProducao);

      totalPedido += precoUnit * qtdComprada;
      custoTotalPedido += custoUnit * qtdComprada;

      itensParaCriar.push({
        produtoId: prod.id,
        quantidade: qtdComprada,
        precoUnitario: precoUnit,
        custoUnitario: custoUnit
      });
    }

    const consumoPorInsumo = calcularConsumoInsumosDosProdutos(produtos, mapaQuantidades);
    const alertasEstoqueBaixo = [];

    // Baixa no estoque (apenas se o pedido já não nascer cancelado)
    if (status !== 'Cancelado') {
      for (const [insumoId, qtdGasta] of consumoPorInsumo.entries()) {
        const insumoAtual = await tx.insumo.findUnique({ where: { id: insumoId } });
        if (!insumoAtual) continue;

        const novoSaldo = arredondar2(Number(insumoAtual.qtdDisponivel || 0) - qtdGasta);

        if (bloquearSemEstoque && novoSaldo < 0) {
          throw new Error(
            `Estoque insuficiente para "${insumoAtual.nome}". Disponível: ${insumoAtual.qtdDisponivel}, necessário: ${arredondar2(qtdGasta)}.`
          );
        }

        await tx.insumo.update({
          where: { id: insumoId },
          data: { qtdDisponivel: novoSaldo }
        });

        if (novoSaldo <= Number(limiteAlertaEstoque)) {
          alertasEstoqueBaixo.push({
            id: insumoAtual.id,
            nome: insumoAtual.nome,
            qtdDisponivel: novoSaldo
          });
        }
      }
    }

    const totalArred = arredondar2(totalPedido);
    const custoArred = arredondar2(custoTotalPedido);
    const lucroEstimado = arredondar2(totalArred - custoArred);

    const pedido = await tx.pedido.create({
      data: {
        idCliente: Number(idCliente),
        status,
        total: totalArred,
        custoTotal: custoArred,
        lucroEstimado,
        itens: {
          create: itensParaCriar
        }
      },
      include: {
        cliente: {
          select: { id: true, nome: true, email: true }
        },
        itens: {
          include: {
            produto: {
              select: { id: true, nome: true, tipo: true }
            }
          }
        }
      }
    });

    return {
      pedido,
      consumoInsumos: [...consumoPorInsumo.entries()].map(([insumoId, quantidadeGasta]) => ({
        insumoId,
        quantidadeGasta: arredondar2(quantidadeGasta)
      })),
      alertasEstoqueBaixo
    };
  });
}

/**
 * Atualiza o status de um pedido. Se passar para 'Cancelado' vindo de outro status,
 * devolve automaticamente as quantidades de insumos para qtdDisponivel.
 */
async function atualizarStatusPedido(pedidoId, novoStatus) {
  return prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findUnique({
      where: { id: Number(pedidoId) },
      include: {
        itens: {
          include: {
            produto: {
              include: {
                insumos: true,
                flores: {
                  include: {
                    flor: { include: { insumos: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!pedido) {
      throw new Error('Pedido não encontrado.');
    }

    const statusAnterior = pedido.status;
    if (statusAnterior === novoStatus) {
      return pedido;
    }

    // Estorno ao cancelar um pedido que havia abatido estoque
    if (novoStatus === 'Cancelado' && statusAnterior !== 'Cancelado') {
      const mapaQuantidades = new Map();
      const produtos = [];

      for (const item of pedido.itens) {
        mapaQuantidades.set(
          item.produtoId,
          (mapaQuantidades.get(item.produtoId) || 0) + Number(item.quantidade || 0)
        );
        if (item.produto) {
          produtos.push(item.produto);
        }
      }

      const consumoParaDevolver = calcularConsumoInsumosDosProdutos(produtos, mapaQuantidades);

      for (const [insumoId, qtdDevolver] of consumoParaDevolver.entries()) {
        const insumoAtual = await tx.insumo.findUnique({ where: { id: insumoId } });
        if (!insumoAtual) continue;

        const saldoDevolvido = arredondar2(
          Number(insumoAtual.qtdDisponivel || 0) + Number(qtdDevolver)
        );

        await tx.insumo.update({
          where: { id: insumoId },
          data: { qtdDisponivel: saldoDevolvido }
        });
      }
    }

    return tx.pedido.update({
      where: { id: pedido.id },
      data: { status: novoStatus },
      include: {
        itens: { include: { produto: true } }
      }
    });
  });
}

module.exports = {
  arredondar2,
  calcularConsumoInsumosDosProdutos,
  criarPedidoComBaixaEstoque,
  atualizarStatusPedido
};