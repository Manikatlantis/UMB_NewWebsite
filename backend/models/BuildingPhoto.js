const mongoose = require('mongoose');

const buildingPhotoSchema = new mongoose.Schema({
  building: { type: String, required: true, index: true },
  face:     { type: Number, required: true }, // 0-3 (front, back, left, right)
  floor:    { type: Number, default: 0 },
  col:      { type: Number, default: 0 },
  photoUrl: { type: String, required: true },
  caption:  { type: String, default: '' },
  season:   { type: String, enum: ['spring', 'summer', 'fall', 'winter', ''], default: '' },
  uploadedBy: { type: String, default: 'Anonymous' },
  status:   { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
}, { timestamps: true });

buildingPhotoSchema.index({ building: 1, face: 1, floor: 1, col: 1 });

module.exports = mongoose.model('BuildingPhoto', buildingPhotoSchema);
