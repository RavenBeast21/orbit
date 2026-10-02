// Centered confirmation dialog. Used for destructive actions like deleting a
// message. The danger action is red, cancel is neutral.
function ConfirmDialog({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', onConfirm, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        {title && <h3 className="confirm-dialog-title">{title}</h3>}
        {message && <p className="confirm-dialog-message">{message}</p>}
        <div className="confirm-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button type="button" className="btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
