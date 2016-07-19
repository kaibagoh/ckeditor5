/**
 * @license Copyright (c) 2003-2016, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

import BaseCommand from './basecommand.js';
import { transformDelta as transformDelta } from './basecommand.js';

/**
 * Redo command stores {@link engine.model.Batch batches} that were used to undo a batch by {@link undo.UndoCommand UndoCommand}.
 * It is able to redo a previously undone batch by reversing the undoing batches created by `UndoCommand`. Reversed batch is
 * also transformed by batches from {@link engine.model.Document#history history} that happened after it and are not other redo batches.
 *
 * Redo command also takes care of restoring {@link engine.model.Document#selection selection} to the state before
 * undone batch was applied.
 *
 * @memberOf undo
 * @extends undo.BaseCommand
 */
export default class RedoCommand extends BaseCommand {
	/**
	 * Executes the command: reverts last {@link engine.model.Batch batch} added to the command's stack, applies
	 * reverted and transformed version on the {@link engine.model.Document document} and removes the batch from the stack.
	 * Then, restores {@link engine.model.Document#selection document selection}.
	 *
	 * @protected
	 */
	_doExecute() {
		const item = this._stack.pop();

		// All changes have to be done in one `enqueueChanges` callback so other listeners will not
		// step between consecutive deltas, or won't do changes to the document before selection is properly restored.
		this.editor.document.enqueueChanges( () => {
			this._redo( item.batch );
			this._restoreSelection( item.selection.ranges, item.selection.isBackward );
		} );

		this.refreshState();
	}

	/**
	 * Re-does a batch by reversing the batch that undone it, transforming that batch and applying it. This is
	 * a helper method for {@link undo.RedoCommand#_doExecute}.
	 *
	 * @private
	 * @param {engine.model.Batch} storedBatch Batch, which deltas will be reversed, transformed and applied.
	 * @param {engine.model.Batch} redoingBatch Batch that will contain transformed and applied deltas from `storedBatch`.
	 * @param {engine.model.Document} document Document that is operated on by the command.
	 */
	_redo( storedBatch ) {
		const document = this.editor.document;

		// All changes done by the command execution will be saved as one batch.
		const redoingBatch = document.batch();
		this._createdBatches.add( redoingBatch );

		const deltasToRedo = storedBatch.deltas.slice();
		deltasToRedo.reverse();

		// We will process each delta from `storedBatch`, in reverse order. If there was deltas A, B and C in stored batch,
		// we need to revert them in reverse order, so first reverse C, then B, then A.
		for ( let deltaToRedo of deltasToRedo ) {
			// Keep in mind that all algorithms return arrays. That's because the transformation might result in multiple
			// deltas, so we need arrays to handle them anyway. To simplify algorithms, it is better to always have arrays
			// in mind. For simplicity reasons, we will use singular form in descriptions and names.

			const nextBaseVersion = deltaToRedo.baseVersion + deltaToRedo.operations.length;

			// As stated above, convert delta to array of deltas.
			let reversedDelta = [ deltaToRedo.getReversed() ];

			// 1. Transform that delta by deltas from history that happened after it.
			// Omit deltas from "redo" batches, because reversed delta already bases on them. Transforming by them
			// again will result in incorrect deltas.
			for ( let historyDelta of document.history.getDeltas( nextBaseVersion ) ) {
				if ( !this._createdBatches.has( historyDelta.batch ) ) {
					reversedDelta = transformDelta( reversedDelta, [ historyDelta ], true );
				}
			}

			// 2. After reversed delta has been transformed by all history deltas, apply it.
			for ( let delta of reversedDelta ) {
				// Fix base version.
				delta.baseVersion = document.version;

				// Before applying, add the delta to the `redoingBatch`.
				redoingBatch.addDelta( delta );

				// Now, apply all operations of the delta.
				for ( let operation of delta.operations ) {
					document.applyOperation( operation );
				}
			}
		}
	}

	/**
	 * Restores {@link engine.model.Document#selection document selection} state after a batch has been re-done. This
	 * is a helper method for {@link undo.RedoCommand#_doExecute}.
	 *
	 * @private
	 * @param {Array.<engine.model.Range>} ranges Ranges to be restored.
	 * @param {Boolean} isBackward Flag describing if restored range was selected forward or backward.
	 */
	_restoreSelection( ranges, isBackward ) {
		this.editor.document.selection.setRanges( ranges, isBackward );
	}
}
