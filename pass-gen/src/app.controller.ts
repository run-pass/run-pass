import { Controller, Get, Header, HttpCode, HttpStatus, Query, Redirect, Res, Response } from '@nestjs/common';
import { AppService } from './app.service';


@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get('passbook')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'application/vnd.apple.pkpass')
  async passbook(@Query() query, @Res() res: Response) {
    const barcode = query.barcode;
    const locations: string[] = [query.locations  || []].flat();

    const file = await this.appService.getPassbook(barcode, locations);
    file.pipe(res as any);
  }

  @Get('github')
  @Redirect("https://github.com/run-pass/run-pass.github.io/")
  async github() {}
}
