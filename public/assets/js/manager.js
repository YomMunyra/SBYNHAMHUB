'use strict';

window.ManagerUI = {
  formatDate(value) {
    return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
      .format(new Date(`${value}T12:00:00`));
  },
  tableLabel(value) {
    return value ? `Table ${value.replace(/^T/, '')}` : 'Unassigned';
  }
};
