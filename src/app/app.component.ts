import { Component, VERSION } from '@angular/core';
import { Buffer } from 'buffer';
import { ZipService } from './zip.service';
import * as FileSaver from 'file-saver';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent {

  constructor(private zipService: ZipService) { }

  async test(e: any) {
    const zip = this.zipService.newZipInstance()
    for(let file of e.target.files){
      const fileBuffer = await file.arrayBuffer();
      const buffer = new Uint8Array(fileBuffer);
      zip.addFile(file.name, buffer)
    }
    zip.getZipFileAsync().then(content => {
      if(!!content){
        FileSaver.saveAs(content, 'zip.zip');
      }
    })
  }
}
