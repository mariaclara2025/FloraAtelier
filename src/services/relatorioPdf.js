const PDFDocument = require('pdfkit');
const { gerarResumoFinanceiro, formatarMoedaBR } = require('./financeiro');

function formatarDataBR(data) {
  if (!data) return '-';
  return new Date(data).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatarDataHoraBR(data) {
  if (!data) return '-';
  return new Date(data).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Gera um Buffer de PDF contendo o relatório financeiro semanal ou mensal.
 *
 * @param {Object} opcoes
 * @param {'semanal'|'mensal'} [opcoes.tipo='semanal']
 * @param {number} [opcoes.ano]
 * @param {number} [opcoes.mes] - 1 a 12 (quando tipo === 'mensal')
 * @param {string|Date} [opcoes.dataInicio]
 * @param {string|Date} [opcoes.dataFim]
 * @returns {Promise<{ buffer: Buffer, nomeArquivo: string, resumo: Object }>}
 */
async function gerarRelatorioFinanceiroPdf(opcoes = {}) {
  const resumo = await gerarResumoFinanceiro(opcoes);

  const tipoLabel = resumo.tipo === 'mensal' ? 'Mensal' : 'Semanal';
  const periodoTexto = `${formatarDataBR(resumo.periodo.inicio)} até ${formatarDataBR(resumo.periodo.fim)}`;
  const emitidoEm = formatarDataHoraBR(new Date());

  const inicioSlug = new Date(resumo.periodo.inicio).toISOString().slice(0, 10);
  const fimSlug = new Date(resumo.periodo.fim).toISOString().slice(0, 10);
  const nomeArquivo = `relatorio-financeiro-${resumo.tipo}-${inicioSlug}-a-${fimSlug}.pdf`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => {
      resolve({
        buffer: Buffer.concat(chunks),
        nomeArquivo,
        resumo
      });
    });
    doc.on('error', reject);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const leftX = doc.page.margins.left;

    const garantirEspaco = (alturaNecessaria = 40) => {
      const limiteInferior = doc.page.height - doc.page.margins.bottom;
      if (doc.y + alturaNecessaria > limiteInferior) {
        doc.addPage();
      }
    };

    // --- CABEÇALHO ---
    doc
      .fillColor('#2B1E24')
      .font('Helvetica-Bold')
      .fontSize(20)
      .text('Flora Atelier', leftX, doc.y);

    doc
      .fillColor('#7A5C68')
      .font('Helvetica')
      .fontSize(12)
      .text(`Relatório Financeiro ${tipoLabel}`, { continued: false });

    doc
      .moveDown(0.3)
      .fillColor('#4A4A4A')
      .fontSize(9.5)
      .text(`Período: ${periodoTexto}   |   Emitido em: ${emitidoEm}`);

    doc
      .moveDown(0.7)
      .strokeColor('#E2D6DC')
      .lineWidth(1)
      .moveTo(leftX, doc.y)
      .lineTo(leftX + pageWidth, doc.y)
      .stroke();

    // --- RESUMO EXECUTIVO ---
    doc.moveDown(1);
    doc
      .fillColor('#2B1E24')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Resumo Financeiro do Período');

    doc.moveDown(0.5);

    const indicadores = [
      ['Faturamento Bruto (Pedidos Válidos)', formatarMoedaBR(resumo.faturamentoBruto)],
      ['Custo de Produção dos Pedidos', formatarMoedaBR(resumo.custoProducaoPedidos)],
      ['Lucro Bruto dos Pedidos', formatarMoedaBR(resumo.lucroBrutoPedidos)],
      ['Outras Despesas (Tabela Custos)', formatarMoedaBR(resumo.outrasDespesas)],
      ['Lucro Líquido do Período', formatarMoedaBR(resumo.lucroLiquido)],
      ['Margem Líquida', `${Number(resumo.margemLiquidaPct || 0).toFixed(2)}%`],
      ['Quantidade de Pedidos Considerados', String(resumo.quantidadePedidos)]
    ];

    for (const [rotulo, valor] of indicadores) {
      garantirEspaco(22);
      const yLinha = doc.y;
      const ehDestaque = rotulo.includes('Lucro Líquido') || rotulo.includes('Faturamento Bruto');

      doc
        .font(ehDestaque ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .fillColor('#222222')
        .text(rotulo, leftX, yLinha, { width: pageWidth * 0.65 });

      doc
        .font(ehDestaque ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(10)
        .fillColor(rotulo.includes('Lucro Líquido') && resumo.lucroLiquido < 0 ? '#B91C1C' : '#111827')
        .text(valor, leftX + pageWidth * 0.65, yLinha, {
          width: pageWidth * 0.35,
          align: 'right'
        });

      doc.y = yLinha + 18;
    }

    // --- ITENS MAIS VENDIDOS ---
    doc.moveDown(0.8);
    garantirEspaco(50);
    doc
      .fillColor('#2B1E24')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Buquês / Itens Vendidos no Período');

    doc.moveDown(0.4);

    if (!resumo.itensMaisVendidos || resumo.itensMaisVendidos.length === 0) {
      doc
        .fillColor('#666666')
        .font('Helvetica')
        .fontSize(9.5)
        .text('Nenhuma venda registrada neste período.');
    } else {
      for (const item of resumo.itensMaisVendidos) {
        garantirEspaco(20);
        const yItem = doc.y;
        doc
          .fillColor('#222222')
          .font('Helvetica')
          .fontSize(9.5)
          .text(
            `${item.quantidadeVendida}x  ${item.nome} (${item.tipo})`,
            leftX,
            yItem,
            { width: pageWidth * 0.6 }
          );

        doc
          .fillColor('#111827')
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .text(
            `Receita: ${formatarMoedaBR(item.receitaTotal)} | Custo: ${formatarMoedaBR(item.custoTotal)}`,
            leftX + pageWidth * 0.55,
            yItem,
            { width: pageWidth * 0.45, align: 'right' }
          );

        doc.y = yItem + 16;
      }
    }

    // --- PEDIDOS DO PERÍODO ---
    doc.moveDown(0.8);
    garantirEspaco(50);
    doc
      .fillColor('#2B1E24')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Pedidos do Período (Exceto Cancelados)');

    doc.moveDown(0.4);

    if (!resumo.pedidos || resumo.pedidos.length === 0) {
      doc
        .fillColor('#666666')
        .font('Helvetica')
        .fontSize(9.5)
        .text('Nenhum pedido válido neste período.');
    } else {
      for (const pedido of resumo.pedidos) {
        garantirEspaco(20);
        const yPed = doc.y;
        const clienteNome = pedido.cliente?.nome || `Cliente #${pedido.idCliente}`;
        doc
          .fillColor('#222222')
          .font('Helvetica')
          .fontSize(9)
          .text(
            `#${pedido.id} • ${formatarDataBR(pedido.data)} • ${clienteNome} [${pedido.status}]`,
            leftX,
            yPed,
            { width: pageWidth * 0.65 }
          );

        doc
          .fillColor('#111827')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(
            `Total: ${formatarMoedaBR(pedido.total)} (Lucro est.: ${formatarMoedaBR(pedido.lucroEstimado)})`,
            leftX + pageWidth * 0.6,
            yPed,
            { width: pageWidth * 0.4, align: 'right' }
          );

        doc.y = yPed + 16;
      }
    }

    // --- OUTRAS DESPESAS / CUSTOS ---
    doc.moveDown(0.8);
    garantirEspaco(50);
    doc
      .fillColor('#2B1E24')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Outras Despesas / Lançamentos em Custos');

    doc.moveDown(0.4);

    if (!resumo.despesas || resumo.despesas.length === 0) {
      doc
        .fillColor('#666666')
        .font('Helvetica')
        .fontSize(9.5)
        .text('Nenhuma despesa adicional registrada neste período.');
    } else {
      for (const custo of resumo.despesas) {
        garantirEspaco(20);
        const yCust = doc.y;
        doc
          .fillColor('#222222')
          .font('Helvetica')
          .fontSize(9)
          .text(
            `${formatarDataBR(custo.data)} • [${custo.categoria}] ${custo.descricao}`,
            leftX,
            yCust,
            { width: pageWidth * 0.72 }
          );

        doc
          .fillColor('#991B1B')
          .font('Helvetica-Bold')
          .fontSize(9)
          .text(
            formatarMoedaBR(custo.valor),
            leftX + pageWidth * 0.72,
            yCust,
            { width: pageWidth * 0.28, align: 'right' }
          );

        doc.y = yCust + 16;
      }
    }

    doc.end();
  });
}

module.exports = {
  gerarRelatorioFinanceiroPdf
};