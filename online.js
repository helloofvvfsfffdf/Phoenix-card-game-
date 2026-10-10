
      // Show each playable card type only once.
      const movesGrid = el('div', 'online-card-grid');
      const cardIds = [...new Set(s.moves.map(move => move.cardId))];

      cardIds.forEach(cardId => {
        const card = window.PhoenixCards.byId(cardId);
        if (!card) return;

        const button = cardFace(card, true);

        button.onclick = () => {
          const possibleMoves = s.moves.filter(
            move => move.cardId === cardId
          );

          // Cards without a target play immediately.
          if (!card.needsTarget) {
            send({
              type: 'move',
              cardId,
              targetId: null
            });
            return;
          }

          // Replace the card grid with a target picker.
          movesGrid.replaceChildren();

          const heading = el(
            'h3',
            '',
            '🎯 Pick your target for ' + card.name
          );
          movesGrid.append(heading);

          const targetGrid = el('div', 'online-card-grid');

          possibleMoves.forEach(move => {
            if (!move.targetId) return;

            const player = s.players.find(
              p => p.id === move.targetId
            );
            if (!player) return;

            const targetButton = el(
              'button',
              'online-primary',
              player.name
            );
            targetButton.type = 'button';

            targetButton.onclick = () => {
              targetGrid.querySelectorAll('button')
                .forEach(b => b.disabled = true);

              send({
                type: 'move',
                cardId,
                targetId: move.targetId
              });
            };

            targetGrid.append(targetButton);
          });

          movesGrid.append(targetGrid);

          const cancel = el('button', '', '← Back to cards');
          cancel.type = 'button';
          cancel.onclick = () => render();
          movesGrid.append(cancel);
        };

        movesGrid.append(button);
      });

      actions.append(movesGrid);
